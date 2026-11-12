export const END_OF_TURN_SILENCE_MS = 3000;

const errorHints = {
  'not-allowed': 'Microphone access was denied. Allow it in your browser settings or type below.',
  'service-not-allowed': 'The browser speech service is unavailable. You can type below.',
  'audio-capture': 'No microphone is available. You can type below.',
  network: 'The browser speech service could not connect. Tap the orb to retry or type below.',
};
const microphoneConstraints = { audio: { echoCancellation: { ideal: 'all' }, noiseSuppression: true, autoGainControl: true }, video: false };
const clean = text => String(text ?? '').replace(/\s+/gu, ' ').trim();

export function createVoiceInput({
  Recognition = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition,
  mediaDevices = globalThis.navigator?.mediaDevices,
  audio,
  silenceMs = END_OF_TURN_SILENCE_MS,
  now = () => performance.now(),
  onState = () => {},
  onActivation = () => {},
  onInterim = () => {},
  onFinal = () => {},
  onActivity = () => {},
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = id => clearTimeout(id),
} = {}) {
  if (!Number.isFinite(silenceMs) || silenceMs <= 0) throw new RangeError('Invalid end-of-turn silence threshold.');
  let current = null, retainedDraft = '';
  const textOf = session => clean([session.prefix, ...session.parts.map(part => part?.text ?? '')].join(' '));
  const owns = (session, recognizer) => current === session && (!recognizer || session.recognizer === recognizer);

  function clearSilence(session) {
    clearTimer(session.silenceTimer); session.silenceTimer = null; session.deadline = null;
  }
  function cleanup(session, keepDraft = false) {
    retainedDraft = keepDraft ? textOf(session) : '';
    if (current === session) current = null;
    for (const timer of [session.readyTimer, session.silenceTimer, session.restartTimer, session.flushTimer]) clearTimer(timer);
    session.graph?.dispose();
    session.stream?.getTracks().forEach(track => track.stop());
    try { session.recognizer?.abort(); } catch { /* No active recognition. */ }
    audio.stopChime(); onActivity(0);
  }
  function fail(session, hint) {
    if (!owns(session)) return;
    cleanup(session, true); onInterim(retainedDraft);
    onState('error', 'Microphone unavailable', hint);
  }
  function publishDraft(session) {
    const text = textOf(session);
    if (text !== session.lastText) { session.lastText = text; onInterim(text); }
  }
  function submit(session) {
    if (!owns(session)) return;
    const text = textOf(session);
    if (!text) { session.finishing = false; session.phase = 'listening'; continueRecognition(session); return; }
    cleanup(session, true);
    if (onFinal(text) !== false) retainedDraft = '';
  }
  function finishTurn(session) {
    if (!owns(session) || session.finishing || !textOf(session)) return;
    session.finishing = true; session.phase = 'finishing';
    clearSilence(session); clearTimer(session.restartTimer);
    // Final segments submit at the deadline. Flush only a still-interim last segment.
    if (!session.parts.some(part => part && !part.final)) { submit(session); return; }
    onState('finishing', 'Finishing your message…', 'Your complete question will appear in the transcript.');
    session.flushTimer = setTimer(() => submit(session), 1000);
    try { session.recognizer.stop(); } catch { submit(session); }
  }
  function speechEndTime(session) {
    if (session.acousticEnd !== null && session.acousticEnd >= session.nativeStart - 150) return session.acousticEnd;
    return session.nativeEnd ?? session.lastEvidence;
  }
  function scheduleSilence(session) {
    if (!owns(session) || !session.ready || session.finishing || !session.heardSpeech || !textOf(session) || session.nativeSpeaking || session.acousticSpeaking) return;
    const ended = speechEndTime(session);
    if (ended === null) return;
    const deadline = ended + silenceMs;
    if (session.silenceTimer !== null && session.deadline === deadline) return;
    clearSilence(session); session.deadline = deadline;
    session.silenceTimer = setTimer(() => {
      if (session.deadline !== deadline) return;
      session.silenceTimer = null;
      if (!owns(session) || session.nativeSpeaking || session.acousticSpeaking) return;
      if (now() < deadline) { scheduleSilence(session); return; }
      finishTurn(session);
    }, Math.max(0, deadline - now()));
  }
  function nativeSpeechStart(session) {
    if (!owns(session) || session.finishing) return;
    session.heardSpeech = true; session.nativeSpeaking = true;
    session.nativeStart = session.lastEvidence = now(); session.nativeEnd = null;
    clearSilence(session);
  }
  function acousticActivity(session, { active, silenceForMs = 0 }) {
    if (!owns(session) || session.finishing) return;
    const wasSpeaking = session.acousticSpeaking;
    session.acousticSpeaking = active;
    if (active) {
      session.heardSpeech = true;
      session.acousticEnd = now() - Math.max(0, silenceForMs);
      clearSilence(session);
    } else {
      if (wasSpeaking) session.acousticEnd = now() - Math.max(0, silenceForMs);
      // Use the actual last voiced frame rather than an engine's delayed speechend event.
      if (session.acousticEnd !== null && session.acousticEnd >= session.nativeStart - 150 && now() - session.acousticEnd > 180) session.nativeSpeaking = false;
      scheduleSilence(session);
    }
  }
  function attachGraph(session, stream) {
    return audio.attachMicrophone(stream, { onSpeechActivity: activity => acousticActivity(session, activity) });
  }
  async function attachLegacyMeter(session) {
    if (session.stream || session.meterPending || !mediaDevices?.getUserMedia) return;
    session.meterPending = true;
    try {
      await session.prepared;
      if (!owns(session)) return;
      const stream = await mediaDevices.getUserMedia(microphoneConstraints);
      if (!owns(session)) { stream.getTracks().forEach(track => track.stop()); return; }
      session.stream = stream; watchTracks(session, stream);
      session.graph = attachGraph(session, stream); session.graph?.startMeter();
    } catch { /* Native recognition still provides speech activity without metering. */ }
    finally { session.meterPending = false; }
  }
  function watchTracks(session, stream) {
    stream.getAudioTracks().forEach(track => track.addEventListener?.('ended', () => {
      if (!session.finishing) fail(session, errorHints['audio-capture']);
    }, { once: true }));
  }
  function ready(session, speechAlreadyStarted = false) {
    if (!owns(session) || !session.started || !session.capturing) return;
    if (session.mode === 'track' && (session.graph?.track.readyState !== 'live' || !session.stream?.getAudioTracks().some(track => track.readyState === 'live'))) {
      fail(session, errorHints['audio-capture']); return;
    }
    clearTimer(session.readyTimer);
    if (session.ready) return;
    session.ready = true; session.phase = 'listening'; session.graph?.startMeter();
    onState('listening', 'Listening…', 'Take your time. Your question sends after a natural pause.');
    const chime = session.mode === 'track' && !speechAlreadyStarted ? audio.playChime(session.graph) : { played: false, delay: 0 };
    onActivation(chime);
    if (session.mode === 'legacy') void attachLegacyMeter(session);
  }
  function makeRecognizer(session) {
    const recognizer = new Recognition();
    session.recognizer = recognizer; session.started = session.capturing = false;
    recognizer.lang = 'en-US'; recognizer.continuous = true; recognizer.interimResults = true;
    recognizer.onstart = () => { if (owns(session, recognizer)) { session.started = true; ready(session); } };
    recognizer.onaudiostart = () => { if (owns(session, recognizer)) { session.capturing = true; ready(session); } };
    recognizer.onspeechstart = () => {
      if (!owns(session, recognizer)) return;
      session.started = session.capturing = true; ready(session, true); nativeSpeechStart(session);
    };
    recognizer.onspeechend = () => {
      if (!owns(session, recognizer) || session.finishing) return;
      session.nativeSpeaking = false; session.nativeEnd ??= now(); scheduleSilence(session);
    };
    recognizer.onresult = event => {
      if (!owns(session, recognizer)) return;
      session.started = session.capturing = true; ready(session, true);
      const previous = textOf(session);
      // Cumulative results belong to one recognition epoch: replace indexed slots, never
      // append all of the browser's previous final results again.
      const results = event.results ?? [];
      for (let index = event.resultIndex ?? 0; index < results.length; index += 1) {
        const result = results[index];
        session.parts[index] = { text: clean(result?.[0]?.transcript), final: Boolean(result?.isFinal) };
      }
      session.parts.length = results.length;
      const text = textOf(session); publishDraft(session);
      if (results.length && results[results.length - 1].isFinal && !session.acousticSpeaking) {
        session.nativeSpeaking = false; session.nativeEnd ??= now();
      }
      if (text !== previous && results.length) {
        session.heardSpeech = true;
        if (!results[results.length - 1].isFinal) {
          session.lastEvidence = now(); clearSilence(session);
          if (!session.graph?.hasSpeechActivity) session.nativeSpeaking = true;
        }
      }
      if (session.finishing) { if (session.parts.every(part => !part || part.final)) submit(session); }
      else scheduleSilence(session);
    };
    recognizer.onerror = event => {
      if (!owns(session, recognizer)) return;
      if (session.finishing) { submit(session); return; }
      if (event.error === 'no-speech') { session.nativeSpeaking = false; scheduleSilence(session); return; }
      fail(session, errorHints[event.error] ?? 'Dictation stopped. Your unsent message is kept below. Tap the orb to retry.');
    };
    recognizer.onend = () => {
      if (!owns(session, recognizer)) return;
      if (session.finishing) { submit(session); return; }
      session.prefix = textOf(session); session.parts = [];
      session.recognizer = null; clearTimer(session.readyTimer);
      session.nativeSpeaking = false; session.nativeEnd ??= now();
      scheduleSilence(session);
      // Keep the raw stream, processed track, meter, and draft. Reconnect recognition only.
      session.restartTimer = setTimer(() => continueRecognition(session), 0);
    };
    session.readyTimer = setTimer(() => fail(session, 'The speech service did not become ready. Your draft is kept below. Tap the orb to retry.'), 20_000);
    return recognizer;
  }
  function continueRecognition(session) {
    if (!owns(session) || session.finishing) return;
    session.restarts = session.restarts.filter(time => now() - time < 10_000);
    if (session.restarts.length >= 5) { fail(session, 'Speech input keeps disconnecting. Your draft is kept below. Tap the orb to reconnect.'); return; }
    session.restarts.push(now()); clearTimer(session.readyTimer);
    try {
      const recognizer = makeRecognizer(session);
      if (session.mode === 'track') recognizer.start(session.graph.track);
      else recognizer.start();
    } catch { fail(session, 'Speech input could not reconnect. Your draft is kept below. Tap the orb to retry.'); }
  }
  async function startWithTrack(session) {
    try {
      if (!mediaDevices?.getUserMedia) { session.mode = 'legacy'; session.recognizer.start(); return; }
      const stream = await mediaDevices.getUserMedia(microphoneConstraints);
      if (!owns(session)) { stream.getTracks().forEach(track => track.stop()); return; }
      session.stream = stream; watchTracks(session, stream);
      if (await session.prepared && owns(session)) session.graph = attachGraph(session, stream);
      if (!owns(session)) return;
      if (!session.graph?.track || session.graph.track.readyState !== 'live') { session.mode = 'legacy'; session.recognizer.start(); }
      else {
        try { session.recognizer.start(session.graph.track); }
        catch (error) { if (error.name !== 'TypeError') throw error; session.mode = 'legacy'; session.recognizer.start(); }
      }
    } catch (error) {
      fail(session, error.name === 'NotAllowedError' ? errorHints['not-allowed'] : error.name === 'NotFoundError' ? errorHints['audio-capture'] : 'The microphone could not start. Tap the orb to retry or type below.');
    }
  }
  function start({ draft = retainedDraft } = {}) {
    if (current) return false;
    retainedDraft = clean(draft);
    if (!Recognition) { onState('error', 'Voice input unavailable', 'Speech input is unavailable in this browser. Your draft can still be sent as text.'); return false; }
    const session = { prefix: retainedDraft, parts: [], lastText: retainedDraft, phase: 'starting', mode: 'legacy', started: false, capturing: false, ready: false,
      nativeSpeaking: false, acousticSpeaking: false, heardSpeech: false, nativeStart: -Infinity, nativeEnd: null, acousticEnd: null, lastEvidence: null,
      silenceTimer: null, deadline: null, restarts: [] };
    current = session;
    try { makeRecognizer(session); }
    catch { current = null; onState('error', 'Voice input unavailable', 'The browser speech service could not start. You can type below.'); return false; }
    onState('starting', 'Opening the microphone…', 'Allow microphone access if your browser asks.');
    session.prepared = audio.prepare();
    try { session.recognizer.start({}); }
    catch (error) {
      if (error.name === 'TypeError') { session.mode = 'track'; void startWithTrack(session); }
      else fail(session, 'The microphone could not start. Tap the orb to retry or type below.');
    }
    return true;
  }
  return {
    start,
    get active() { return current !== null; },
    get phase() { return current?.phase ?? 'idle'; },
    get draft() { return current ? textOf(current) : retainedDraft; },
    pause() { if (current) { cleanup(current, true); onInterim(retainedDraft); } return retainedDraft; },
    cancel() { if (current) cleanup(current); retainedDraft = ''; },
    finish() { if (current) finishTurn(current); },
  };
}
