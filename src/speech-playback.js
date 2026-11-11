import { splitSpeechText, speechHash, OPENAI_VOICES, MAX_AUDIO_BYTES } from './speech-config.js';

const abortError = () => new DOMException('Playback stopped.', 'AbortError');
function playbackError(message, code) { return Object.assign(new Error(message), { code }); }

export function createSpeechPlayback({ voiceAudio, synthesis = globalThis.speechSynthesis, onLevel = () => {} }) {
  const cache = new Map();
  const pending = new Map();
  let cacheBytes = 0, current = null, configuration;
  const loadConfiguration = () => configuration ??= fetch('/api/speech/config', { cache: 'no-store' })
    .then(async response => { const body = await response.json(); if (!response.ok) throw playbackError(body.error, body.code); return body; })
    .catch(error => { configuration = null; throw error; });
  void loadConfiguration().catch(() => {}); // Establish the signed visitor cookie before a generation request.

  function remember(key, clip) {
    if (cache.has(key)) return;
    while (cache.size >= 12 || cacheBytes + clip.blob.size > 32 * 1024 * 1024) {
      const oldest = cache.keys().next().value;
      if (!oldest) break;
      cacheBytes -= cache.get(oldest).blob.size; cache.delete(oldest);
    }
    cache.set(key, clip); cacheBytes += clip.blob.size;
  }
  function forget(clip) {
    for (const [key, entry] of cache) if (entry === clip) { cacheBytes -= entry.blob.size; cache.delete(key); }
  }
  function alive(job) { if (current !== job) throw abortError(); }
  function cancel() {
    const job = current;
    current = null;
    if (!job) return;
    job.reject?.(abortError());
    job.releaseAppend?.();
    job.abortAppend?.();
    job.monitor?.dispose();
    if (job.audio) { job.audio.pause(); job.audio.removeAttribute('src'); job.audio.load(); }
    if (job.url) URL.revokeObjectURL(job.url);
    if (job.utterance) synthesis?.cancel();
    onLevel(null);
  }
  async function collect(input, key, onChunk) {
    const config = await loadConfiguration();
    if (!config.available) throw playbackError('TTS-1 is unavailable. Retry or choose Device Voice.', 'model_unavailable');
    const response = await fetch('/api/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    if (!response.ok) { const body = await response.json().catch(() => ({})); throw playbackError(body.error ?? 'OpenAI voice failed. Retry or choose Device Voice.', body.code ?? 'generation_failed'); }
    const parts = [];
    let bytes = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_AUDIO_BYTES) { await reader.cancel(); throw playbackError('Audio exceeded the playback size limit.', 'audio_too_large'); }
        parts.push(value);
        await onChunk?.(value);
      }
    } finally { reader.releaseLock(); }
    if (!bytes) throw playbackError('No audio was returned. Retry or choose Device Voice.', 'empty_audio');
    const url = response.headers.get('X-Speech-Playback');
    const clip = { blob: new Blob(parts, { type: 'audio/mpeg' }), playbackUrl: /^\/api\/speech\/audio\/[a-f0-9]{64}\?expires=\d{10}&token=[a-f0-9]{64}$/.test(url ?? '') ? url : null };
    remember(key, clip); return clip;
  }
  function media(job, callbacks) {
    job.audio = new Audio();
    job.audio.preload = 'auto';
    if (job.analyze) {
      try { job.monitor = voiceAudio.monitorPlayback(job.audio, onLevel); }
      catch { job.monitor = null; }
    }
    job.audio.onplaying = () => {
      if (current !== job) return;
      job.monitor?.start();
      onLevel(job.monitor ? 0 : null);
      callbacks.onState?.('speaking');
    };
    job.audio.onwaiting = () => { if (current === job) { job.monitor?.pause(); callbacks.onState?.('loading'); } };
    const ended = new Promise((resolve, reject) => {
      job.reject = reject;
      job.audio.onended = () => { job.monitor?.dispose(); job.monitor = null; onLevel(null); resolve(); };
      job.audio.onerror = () => reject(playbackError('Audio could not play. Retry audio or choose Device Voice.', 'playback_failed'));
    });
    ended.catch(() => {});
    return ended;
  }
  async function startAudio(job) {
    alive(job);
    try { await job.audio.play(); }
    catch (error) { if (current !== job) throw abortError(); throw playbackError(error.name === 'NotAllowedError' ? 'Your browser paused audio. Click Retry to play the prepared audio.' : 'Audio could not start. Retry or choose Device Voice.', error.name === 'NotAllowedError' ? 'playback_blocked' : 'playback_failed'); }
  }
  function releaseMedia(job) {
    job.monitor?.dispose(); job.monitor = null;
    if (job.audio) { job.audio.onplaying = job.audio.onwaiting = job.audio.onended = job.audio.onerror = null; job.audio.pause(); job.audio.removeAttribute('src'); job.audio.load(); }
    if (job.url) URL.revokeObjectURL(job.url);
    job.url = null; job.audio = null;
  }
  async function clipPlayback(job, clip, callbacks, preferHttp = false) {
    // Some embedded browsers reject blob URLs. A signed same-origin cache URL plays the same
    // already-generated clip through ordinary HTTP, without changing provider or billing again.
    const sources = preferHttp && clip.playbackUrl ? ['http'] : clip.playbackUrl ? ['blob', 'http'] : ['blob'];
    for (const source of sources) {
      alive(job);
      const ended = media(job, callbacks);
      if (source === 'http') job.audio.src = clip.playbackUrl;
      else { job.url = URL.createObjectURL(clip.blob); job.audio.src = job.url; }
      try { await startAudio(job); await ended; alive(job); releaseMedia(job); return; }
      catch (error) {
        releaseMedia(job); alive(job);
        if (error.code === 'playback_blocked') throw error;
        if (source === sources.at(-1)) { if (source === 'http') forget(clip); throw error; }
      }
    }
  }
  async function openaiChunk(job, input, callbacks) {
    const key = await speechHash(input); alive(job);
    if (cache.has(key)) { await clipPlayback(job, cache.get(key), callbacks); return; }
    if (pending.has(key)) { const clip = await pending.get(key); await clipPlayback(job, clip, callbacks); return; }
    if (pending.size >= 2) throw playbackError('Audio is still being prepared. Please retry shortly.', 'generation_pending');
    const useStream = typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('audio/mpeg');
    let stream, buffer, streamError, ended, append;
    if (useStream) {
      ended = media(job, callbacks);
      ended.catch(() => {});
      stream = new MediaSource(); job.url = URL.createObjectURL(stream); job.audio.src = job.url;
      append = new Promise(resolve => { job.releaseAppend = resolve; stream.addEventListener('sourceopen', () => {
        try { buffer = stream.addSourceBuffer('audio/mpeg'); buffer.mode = 'sequence'; } catch (error) { streamError = error; }
        resolve();
      }, { once: true }); });
    }
    const obtaining = collect(input, key, useStream ? async value => {
      if (current !== job || streamError) return;
      await append;
      if (current !== job || streamError) return;
      try {
        await new Promise((resolve, reject) => {
          const finish = () => { buffer.removeEventListener('error', failed); job.abortAppend = null; resolve(); };
          const failed = () => { buffer.removeEventListener('updateend', finish); job.abortAppend = null; reject(new Error('Audio stream append failed.')); };
          job.abortAppend = finish;
          buffer.addEventListener('updateend', finish, { once: true });
          buffer.addEventListener('error', failed, { once: true });
          buffer.appendBuffer(value);
        });
      } catch (error) { streamError = error; }
    } : null);
    pending.set(key, obtaining);
    obtaining.finally(() => pending.delete(key)).catch(() => {});
    try {
      if (useStream) {
        let clip;
        try {
          const playing = startAudio(job);
          playing.catch(error => { streamError = error; job.releaseAppend?.(); job.abortAppend?.(); });
          clip = await obtaining; alive(job);
          if (streamError) throw streamError;
          await append;
          if (stream.readyState === 'open') stream.endOfStream();
          await playing; await ended; alive(job); releaseMedia(job);
        } catch (error) {
          if (current !== job) throw abortError();
          releaseMedia(job);
          if (!clip || error.code === 'playback_blocked') throw error;
          await clipPlayback(job, clip, callbacks, true);
        }
      } else {
        const clip = await obtaining; await clipPlayback(job, clip, callbacks);
      }
    } catch (error) { if (current === job) releaseMedia(job); throw error; }
  }
  async function devicePlayback(job, text, settings, callbacks) {
    const voice = synthesis?.getVoices().find(item => item.voiceURI === settings.deviceVoice);
    if (!voice) throw playbackError('The selected device voice is unavailable. Choose an available device voice.', 'device_unavailable');
    const utterance = job.utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice; utterance.lang = voice.lang; utterance.rate = settings.speed; utterance.pitch = 1;
    onLevel(null);
    await new Promise((resolve, reject) => {
      job.reject = reject;
      utterance.onstart = () => { if (current === job) callbacks.onState?.('speaking'); };
      utterance.onend = resolve;
      utterance.onerror = () => reject(playbackError('Device speech was interrupted. Retry with an available device voice.', 'device_failed'));
      synthesis.speak(utterance);
    });
  }
  return {
    async play(text, settings, callbacks = {}, analyze = false) {
      cancel();
      const job = current = { analyze };
      callbacks.onState?.('loading');
      try {
        if (analyze) await voiceAudio.prepare();
        alive(job);
        if (settings.provider === 'device') await devicePlayback(job, text, settings, callbacks);
        else {
          if (!OPENAI_VOICES.includes(settings.voice)) throw playbackError('This voice is unavailable with TTS-1. Choose an enabled voice.', 'voice_unavailable');
          for (const chunk of splitSpeechText(text)) { alive(job); callbacks.onState?.('loading'); await openaiChunk(job, { text: chunk, voice: settings.voice, speed: settings.speed }, callbacks); }
        }
        alive(job); current = null; onLevel(null); callbacks.onEnd?.();
      } catch (error) {
        if (current !== job || error.name === 'AbortError') return;
        cancel(); callbacks.onError?.(error);
      }
    },
    cancel,
    get active() { return current !== null; },
  };
}
