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

  function remember(key, blob) {
    if (cache.has(key)) return;
    while (cache.size >= 12 || cacheBytes + blob.size > 32 * 1024 * 1024) {
      const oldest = cache.keys().next().value;
      if (!oldest) break;
      cacheBytes -= cache.get(oldest).size; cache.delete(oldest);
    }
    cache.set(key, blob); cacheBytes += blob.size;
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
    const blob = new Blob(parts, { type: 'audio/mpeg' }); remember(key, blob); return blob;
  }
  function media(job, callbacks) {
    job.audio = new Audio();
    job.audio.preload = 'auto';
    if (job.analyze) job.monitor = voiceAudio.monitorPlayback(job.audio, onLevel);
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
    catch (error) { if (current !== job) throw abortError(); throw playbackError(error.name === 'NotAllowedError' ? 'Your browser paused audio. Click Retry to play the prepared audio.' : 'Audio could not start. Retry or choose Device Voice.', 'playback_blocked'); }
  }
  function releaseMedia(job) {
    job.monitor?.dispose(); job.monitor = null;
    if (job.audio) { job.audio.onplaying = job.audio.onwaiting = job.audio.onended = job.audio.onerror = null; job.audio.pause(); job.audio.removeAttribute('src'); job.audio.load(); }
    if (job.url) URL.revokeObjectURL(job.url);
    job.url = null; job.audio = null;
  }
  async function blobPlayback(job, blob, callbacks) {
    alive(job);
    const ended = media(job, callbacks);
    job.url = URL.createObjectURL(blob); job.audio.src = job.url;
    await startAudio(job); await ended; alive(job); releaseMedia(job);
  }
  async function openaiChunk(job, input, callbacks) {
    const key = await speechHash(input); alive(job);
    if (cache.has(key)) { await blobPlayback(job, cache.get(key), callbacks); return; }
    if (pending.has(key)) { const blob = await pending.get(key); await blobPlayback(job, blob, callbacks); return; }
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
        const playing = startAudio(job); playing.catch(() => {});
        await obtaining; alive(job);
        if (streamError) throw playbackError('Streaming playback could not finish. Retry the prepared audio.', 'playback_failed');
        await append;
        if (stream.readyState === 'open') stream.endOfStream();
        await playing; await ended; alive(job); releaseMedia(job);
      } else {
        const blob = await obtaining; await blobPlayback(job, blob, callbacks);
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
