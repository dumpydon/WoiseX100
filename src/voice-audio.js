export const CHIME_DURATION = 0.4;
export const CHIME_FREQUENCIES = [392, 523.251];
export const CHIME_FILTER_FREQUENCIES = CHIME_FREQUENCIES.flatMap(frequency => [frequency, frequency * 2]);
export const CHIME_FILTER_Q = 7;
const soundsKey = 'woisex100:interface-sounds';

export function readInterfaceSounds(storage) {
  try { return storage?.getItem(soundsKey) !== 'off'; } catch { return true; }
}

export function saveInterfaceSounds(storage, enabled) {
  try { storage?.setItem(soundsKey, enabled ? 'on' : 'off'); } catch { /* Session-only preference when storage is blocked. */ }
}

// Original 400 ms G4–C5 cue. Smooth envelopes and a quiet second harmonic give a rounded bell timbre.
export function activationChimeSamples(sampleRate) {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new RangeError('Unsupported sample rate.');
  const samples = new Float32Array(Math.round(sampleRate * CHIME_DURATION));
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / sampleRate;
    for (const [note, frequency] of CHIME_FREQUENCIES.entries()) {
      const local = time - note * 0.14;
      if (local < 0 || local >= 0.26) continue;
      const attack = Math.sin(Math.min(local / 0.022, 1) * Math.PI / 2) ** 2;
      const release = Math.sin(Math.min((0.26 - local) / 0.055, 1) * Math.PI / 2) ** 2;
      const envelope = attack * release * Math.exp(-local * 8);
      samples[index] += (note ? 0.065 : 0.06) * envelope
        * (Math.sin(2 * Math.PI * frequency * local) + 0.14 * Math.sin(4 * Math.PI * frequency * local));
    }
  }
  return samples;
}

export function createVoiceAudio({
  AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext,
  requestFrame = callback => globalThis.requestAnimationFrame(callback),
  cancelFrame = id => globalThis.cancelAnimationFrame(id),
  onLevel = () => {},
  enabled = true,
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = id => clearTimeout(id),
} = {}) {
  let context;
  let cue;
  let buffer;
  const graphs = new Set();

  function stopChime() {
    if (!cue) return;
    const current = cue;
    cue = null;
    try {
      const now = context.currentTime;
      current.gain.gain.cancelScheduledValues(now);
      current.gain.gain.setTargetAtTime(0, now, 0.004);
      current.source.stop(now + 0.025);
    } catch { /* Already ended or context closed. */ }
  }

  function prepare() {
    if (!AudioContextClass) return Promise.resolve(false);
    try {
      if (!context || context.state === 'closed') { context = new AudioContextClass(); buffer = null; }
      if (context.state === 'running') return Promise.resolve(true);
      const resumed = context.resume();
      return new Promise(resolve => {
        const timeout = setTimer(() => resolve(false), 350);
        resumed.then(() => { clearTimer(timeout); resolve(context.state === 'running'); }, () => { clearTimer(timeout); resolve(false); });
      });
    } catch { return Promise.resolve(false); }
  }

  function attachMicrophone(stream) {
    if (!context || context.state !== 'running') return null;
    const source = context.createMediaStreamSource(stream);
    const dry = context.createGain();
    const filtered = context.createGain();
    const bus = context.createGain();
    const analyser = context.createAnalyser();
    const destination = context.createMediaStreamDestination();
    const filters = CHIME_FILTER_FREQUENCIES.map(frequency => {
      const filter = context.createBiquadFilter();
      filter.type = 'notch';
      filter.frequency.value = frequency;
      filter.Q.value = CHIME_FILTER_Q;
      return filter;
    });
    dry.gain.value = 1;
    filtered.gain.value = 0;
    source.connect(dry);
    dry.connect(bus);
    source.connect(filters[0]);
    filters.forEach((filter, index) => filter.connect(filters[index + 1] ?? filtered));
    filtered.connect(bus);
    bus.connect(destination);
    bus.connect(analyser);
    analyser.fftSize = 512;
    const data = new Float32Array(analyser.fftSize);
    let frame = null;
    let smoothed = 0;
    let disposed = false;
    const graph = {
      track: destination.stream.getAudioTracks()[0],
      protectChime(start, end) {
        // Crossfade narrow note filters into the mic path; never mute or time-gate the user's speech.
        for (const [gain, from, to] of [[dry.gain, 1, 0], [filtered.gain, 0, 1]]) {
          gain.cancelScheduledValues(start);
          gain.setValueAtTime(from, start);
          gain.linearRampToValueAtTime(to, start + 0.008);
          gain.setValueAtTime(to, end + 0.12);
          gain.linearRampToValueAtTime(from, end + 0.14);
        }
      },
      startMeter() {
        if (frame !== null || disposed) return;
        const tick = () => {
          if (disposed) return;
          analyser.getFloatTimeDomainData(data);
          const rms = Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
          const level = Math.min(1, Math.max(0, (rms - 0.006) / 0.075));
          smoothed += (level - smoothed) * (level > smoothed ? 0.5 : 0.18);
          onLevel(smoothed);
          frame = requestFrame(tick);
        };
        frame = requestFrame(tick);
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        if (frame !== null) cancelFrame(frame);
        for (const node of [source, dry, filtered, bus, analyser, destination, ...filters]) {
          try { node.disconnect(); } catch { /* Already disconnected. */ }
        }
        destination.stream.getTracks().forEach(track => track.stop());
        graphs.delete(graph);
        onLevel(0);
      },
    };
    graphs.add(graph);
    return graph;
  }

  function playChime(graph) {
    if (!enabled || context?.state !== 'running' || !graph || !graphs.has(graph)) return { played: false, delay: 0 };
    stopChime();
    try {
      if (!buffer) {
        const samples = activationChimeSamples(context.sampleRate);
        buffer = context.createBuffer(1, samples.length, context.sampleRate);
        buffer.copyToChannel(samples, 0);
      }
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      gain.gain.value = 0.6;
      source.connect(gain);
      gain.connect(context.destination); // Speakers only: never connect this to the recognition track.
      const now = context.currentTime;
      const delay = 0.018;
      graph.protectChime(now, now + delay + CHIME_DURATION);
      cue = { source, gain };
      source.onended = () => {
        if (cue?.source === source) cue = null;
        source.disconnect();
        gain.disconnect();
      };
      source.start(now + delay);
      return { played: true, delay };
    } catch { stopChime(); return { played: false, delay: 0 }; }
  }

  return {
    prepare,
    attachMicrophone,
    playChime,
    stopChime,
    get enabled() { return enabled; },
    setEnabled(value) { enabled = Boolean(value); if (!enabled) stopChime(); },
    suspend() { stopChime(); context?.suspend().catch(() => {}); },
    dispose() {
      stopChime();
      for (const graph of graphs) graph.dispose();
      context?.close().catch(() => {});
    },
  };
}
