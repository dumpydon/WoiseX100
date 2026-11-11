const errorHints = {
  'not-allowed': 'Microphone access was denied. Allow it in your browser settings or type below.',
  'service-not-allowed': 'The browser speech service is unavailable. You can type below.',
  'audio-capture': 'No microphone is available. You can type below.',
  'no-speech': 'No speech was heard. Tap the mic to try again or type below.',
  network: 'The browser speech service could not connect. Tap the mic to retry or type below.',
};
const microphoneConstraints = { audio: { echoCancellation: { ideal: 'all' }, noiseSuppression: true, autoGainControl: true }, video: false };

export function createVoiceInput({
  Recognition = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition,
  mediaDevices = globalThis.navigator?.mediaDevices,
  audio,
  onState = () => {},
  onActivation = () => {},
  onInterim = () => {},
  onFinal = () => {},
  onActivity = () => {},
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = id => clearTimeout(id),
} = {}) {
  let current = null;

  function cleanup(session) {
    if (current === session) current = null;
    clearTimer(session.timer);
    session.graph?.dispose();
    session.stream?.getTracks().forEach(track => track.stop());
    try { session.recognizer.abort(); } catch { /* No active recognition. */ }
    audio.stopChime();
    onActivity(0);
  }

  function fail(session, hint) {
    if (current !== session) return;
    cleanup(session);
    onState('error', 'Microphone unavailable', hint);
  }

  async function attachLegacyMeter(session, prepared) {
    if (session.graph || !mediaDevices?.getUserMedia || !await prepared || current !== session) return;
    try {
      const stream = await mediaDevices.getUserMedia(microphoneConstraints);
      if (current !== session) { stream.getTracks().forEach(track => track.stop()); return; }
      session.stream = stream;
      session.graph = audio.attachMicrophone(stream);
      session.graph?.startMeter();
    } catch { /* Native recognition still works; speech events provide an activity fallback. */ }
  }

  function ready(session, speechAlreadyStarted = false) {
    if (current !== session || session.ready || !session.started || !session.capturing) return;
    if (session.mode === 'track' && (session.graph?.track.readyState !== 'live'
      || !session.stream?.getAudioTracks().some(track => track.readyState === 'live'))) {
      fail(session, errorHints['audio-capture']);
      return;
    }
    session.ready = true;
    session.phase = 'listening';
    clearTimer(session.timer);
    session.graph?.startMeter();
    onState('listening', 'Listening…', 'Ask your question. The transcript will appear below.');
    // Uncontrolled legacy microphone input must remain silent: do not risk recognising the cue.
    const chime = session.mode === 'track' && !speechAlreadyStarted
      ? audio.playChime(session.graph) : { played: false, delay: 0 };
    onActivation(chime);
    if (session.mode === 'legacy') void attachLegacyMeter(session, session.prepared);
  }

  async function startWithTrack(session) {
    try {
      if (!mediaDevices?.getUserMedia) {
        session.mode = 'legacy';
        session.recognizer.start();
        return;
      }
      const stream = await mediaDevices.getUserMedia(microphoneConstraints);
      if (current !== session) { stream.getTracks().forEach(track => track.stop()); return; }
      session.stream = stream;
      stream.getAudioTracks().forEach(track => track.addEventListener?.('ended', () => fail(session, errorHints['audio-capture']), { once: true }));
      if (await session.prepared && current === session) session.graph = audio.attachMicrophone(stream);
      if (current !== session) return;
      if (!session.graph?.track || session.graph.track.readyState !== 'live') {
        stream.getTracks().forEach(track => track.stop());
        session.stream = null;
        session.mode = 'legacy';
        session.recognizer.start();
      } else {
        try { session.recognizer.start(session.graph.track); }
        catch (error) {
          if (error.name !== 'TypeError') throw error;
          session.mode = 'legacy';
          session.recognizer.start();
        }
      }
    } catch (error) {
      const hint = error.name === 'NotAllowedError' ? errorHints['not-allowed']
        : error.name === 'NotFoundError' ? errorHints['audio-capture']
          : 'The microphone could not start. Tap the mic to retry or type below.';
      fail(session, hint);
    }
  }

  function start() {
    if (current) return false;
    if (!Recognition) {
      onState('error', 'Voice input unavailable', 'Speech input is unavailable in this browser. You can type below and hear the reply.');
      return false;
    }
    let recognizer;
    try { recognizer = new Recognition(); }
    catch {
      onState('error', 'Voice input unavailable', 'The browser speech service could not start. You can type below.');
      return false;
    }
    const session = { recognizer, phase: 'starting', mode: 'legacy', started: false, capturing: false, ready: false };
    current = session;
    onState('starting', 'Opening the microphone…', 'Allow microphone access if your browser asks.');
    session.prepared = audio.prepare(); // Called in the opening click gesture, before any permission await.
    recognizer.lang = 'en-US';
    recognizer.continuous = false;
    recognizer.interimResults = true;
    recognizer.onstart = () => { session.started = true; ready(session); };
    recognizer.onaudiostart = () => { session.capturing = true; ready(session); };
    recognizer.onspeechstart = () => {
      session.started = session.capturing = true;
      ready(session, true);
      if (current === session && !session.graph) onActivity(0.45);
    };
    recognizer.onspeechend = () => { if (current === session && !session.graph) onActivity(0); };
    recognizer.onresult = event => {
      if (current !== session) return;
      const result = event.results?.[event.resultIndex];
      const text = result?.[0]?.transcript?.trim();
      if (!text) return;
      session.started = session.capturing = true;
      ready(session, true);
      if (result.isFinal) { cleanup(session); onFinal(text); }
      else onInterim(text);
    };
    recognizer.onerror = event => fail(session, errorHints[event.error] ?? 'Dictation stopped. Tap the mic to retry or type below.');
    recognizer.onend = () => {
      if (current !== session) return;
      cleanup(session);
      onState('idle', 'Microphone off', 'Tap the mic to ask another question.');
    };
    session.timer = setTimer(() => fail(session, 'The microphone did not become ready. Tap the mic to retry or type below.'), 20_000);
    try {
      // A track-aware WebIDL implementation rejects a non-track before capturing anything.
      // A legacy zero-argument implementation ignores it and starts its normal mic session.
      // Adopt that legacy session silently rather than probing with a second recording.
      recognizer.start({});
    } catch (error) {
      if (error.name === 'TypeError') { session.mode = 'track'; void startWithTrack(session); }
      else fail(session, 'The microphone could not start. Tap the mic to retry or type below.');
    }
    return true;
  }

  return {
    start,
    get active() { return current !== null; },
    get phase() { return current?.phase ?? 'idle'; },
    cancel() { if (current) cleanup(current); },
    finish() {
      if (!current) return;
      if (!current.ready) { cleanup(current); onState('idle', 'Microphone off', 'Tap the mic when you’re ready.'); return; }
      const session = current;
      session.phase = 'finishing';
      onState('finishing', 'Finishing dictation…', 'Your question will appear in the transcript.');
      session.timer = setTimer(() => fail(session, 'Dictation did not finish. Tap the mic to retry or type below.'), 5000);
      try { session.recognizer.stop(); } catch { cleanup(session); }
    },
  };
}
