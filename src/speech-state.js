import { DurableObject } from 'cloudflare:workers';
import { characterCount, validateSpeechInput, speechHash, speechLimits, speechError, MAX_AUDIO_BYTES, SPEECH_MODEL } from './speech-config.js';
import { ttsOneProvider } from './tts-one-provider.js';
import { SpeechLedger } from './speech-ledger.js';

// One coordination atom per visitor, IP backstop, or global budget; no audio passes through this actor.
export class SpeechQuota extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ledger = new SpeechLedger(ctx.storage.sql);
    });
  }
  reserve(id, characters, limit) { return this.ledger.reserve(id, characters, limit); }
  commit(id) { this.ledger.commit(id); }
  release(id) { this.ledger.release(id); }
  summary(limit, price) { return this.ledger.summary(limit, price); }
}

// One actor per (tts-1, voice, speed, exact text) hash. It serializes only identical generation jobs.
export class SpeechJob extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.generation = null;
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS audio_chunks (sequence INTEGER PRIMARY KEY, bytes BLOB NOT NULL)');
    });
  }
  audioResponse(metadata, cache) {
    let index = 0;
    const storage = this.ctx.storage;
    const body = new ReadableStream({
      pull(controller) {
        if (index >= metadata.chunks) { controller.close(); return; }
        const row = storage.sql.exec('SELECT bytes FROM audio_chunks WHERE sequence=?', index++).toArray()[0];
        if (!row) { controller.error(new Error('Cached audio is incomplete.')); return; }
        controller.enqueue(new Uint8Array(row.bytes));
      },
    });
    return new Response(body, { headers: this.audioHeaders(cache, 0) });
  }
  audioHeaders(cache, characters) {
    return { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Speech-Cache': cache, 'X-Speech-Characters': String(characters) };
  }
  async synthesize(data) {
    const input = validateSpeechInput({ text: data.text, voice: data.voice, speed: data.speed });
    if (!input || !/^[a-f0-9]{32}$/.test(data.userId) || !/^[a-f0-9]{64}$/.test(data.ipId) || await speechHash(input) !== data.hash) return speechError('Invalid speech request.', 'invalid_input', 400);
    if (!ttsOneProvider.available(this.env)) return speechError('TTS-1 is unavailable. Choose Device Voice to continue.', 'model_unavailable', 410);
    if (this.generation) {
      const completed = await this.generation;
      const ready = await this.ctx.storage.get('job');
      return completed && ready?.state === 'ready' ? this.audioResponse(ready, 'HIT')
        : speechError('Audio generation did not finish. Retry or choose Device Voice.', 'generation_failed', 502);
    }
    let complete;
    this.generation = new Promise(resolve => { complete = resolve; });
    const finish = success => { this.generation = null; complete(success); };
    let id, quotas = [], dispatched = false;
    try {
      const previous = await this.ctx.storage.get('job');
      if (previous?.state === 'ready' && previous.expires > Date.now()) { finish(true); return this.audioResponse(previous, 'HIT'); }
      if (previous?.state === 'generating' && previous.lease > Date.now()) {
        finish(false);
        return speechError('This audio is still being generated. Retry shortly.', 'generation_pending', 409, { 'Retry-After': '5' });
      }
      const limits = speechLimits(this.env);
      id = crypto.randomUUID();
      const characters = characterCount(input.text);
      quotas = [
        { stub: this.env.SPEECH_QUOTA.getByName('user:' + data.userId), limit: limits.user },
        { stub: this.env.SPEECH_QUOTA.getByName('ip:' + data.ipId), limit: limits.ip },
        { stub: this.env.SPEECH_QUOTA.getByName('global'), limit: limits.global },
      ];
      await this.ctx.storage.put('job', { state: 'generating', lease: Date.now() + 120000 });
      await this.ctx.storage.setAlarm(Date.now() + 121000);
      for (const quota of quotas) {
        const admission = await quota.stub.reserve(id, characters, quota.limit);
        if (!admission.ok) {
          await Promise.all(quotas.map(item => item.stub.release(id)));
          await this.ctx.storage.put('job', { state: 'failed' });
          finish(false);
          return speechError('The OpenAI voice usage limit has been reached. You can choose Device Voice.', 'usage_limit', 429, { 'Retry-After': String(admission.retryAfter) });
        }
      }
      await Promise.all(quotas.map(item => item.stub.commit(id)));
      dispatched = true;
      const upstream = await ttsOneProvider.generate(input, this.env);
      if (!upstream.ok || !upstream.body) {
        // Explicit rejection before generation is not charged. Ambiguous failures stay conservative.
        if (upstream.status >= 400 && upstream.status < 500) await Promise.all(quotas.map(item => item.stub.release(id)));
        await this.ctx.storage.put('job', { state: 'failed' });
        finish(false);
        const unavailable = [400, 403, 404, 410].includes(upstream.status);
        return speechError(unavailable ? 'TTS-1 or this voice is unavailable for this API key. Retry or choose Device Voice.' : 'OpenAI speech generation failed. Retry or choose Device Voice.', unavailable ? 'model_unavailable' : 'generation_failed', unavailable ? 503 : 502);
      }
      console.log(JSON.stringify({ event: 'tts_submitted', model: SPEECH_MODEL, voice: input.voice, characters, estimatedCostUsd: characters * limits.price / 1000000 }));
      this.ctx.storage.sql.exec('DELETE FROM audio_chunks');
      let bytes = 0;
      const bounded = upstream.body.pipeThrough(new TransformStream({
        transform(chunk, controller) {
          bytes += chunk.byteLength;
          if (bytes > MAX_AUDIO_BYTES) { controller.error(new Error('Generated audio exceeded its size limit.')); return; }
          controller.enqueue(chunk);
        },
      }));
      const [playback, caching] = bounded.tee();
      const saving = (async () => {
        const reader = caching.getReader();
        let chunks = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            for (let offset = 0; offset < value.byteLength; offset += 65536) {
              const part = value.slice(offset, offset + 65536);
              this.ctx.storage.sql.exec('INSERT INTO audio_chunks VALUES (?,?)', chunks++, part.buffer);
            }
          }
          if (!chunks) throw new Error('Empty audio.');
          const expires = Date.now() + limits.cacheSeconds * 1000;
          await this.ctx.storage.put('job', { state: 'ready', chunks, bytes, expires });
          await this.ctx.storage.setAlarm(expires);
          finish(true);
        } catch {
          this.ctx.storage.sql.exec('DELETE FROM audio_chunks');
          await this.ctx.storage.put('job', { state: 'failed' });
          finish(false);
        } finally { reader.releaseLock(); }
      })();
      this.ctx.waitUntil(saving);
      // Keep filling the private cache if playback is stopped; a replay must not regenerate an accepted call.
      return new Response(playback, { headers: this.audioHeaders('MISS', characters) });
    } catch {
      if (id && !dispatched) await Promise.allSettled(quotas.map(item => item.stub.release(id)));
      await this.ctx.storage.put('job', { state: 'failed' });
      finish(false);
      return speechError('OpenAI voice could not finish. Retry or choose Device Voice.', 'generation_failed', 502);
    }
  }
  async alarm() {
    const job = await this.ctx.storage.get('job');
    const deadline = job?.state === 'generating' ? job.lease : job?.expires;
    if (deadline && deadline > Date.now()) { await this.ctx.storage.setAlarm(deadline); return; }
    this.ctx.storage.sql.exec('DELETE FROM audio_chunks');
    await this.ctx.storage.delete('job');
  }
}
