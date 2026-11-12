const tau = Math.PI * 2;
const clamp = value => Math.min(1, Math.max(0, Number(value) || 0));

export function orbStateForVoice(state) {
  if (state === 'listening') return 'listening';
  if (state === 'thinking' || state === 'finishing') return 'processing';
  if (state === 'speaking') return 'speaking';
  if (state === 'starting') return 'idle';
  return 'muted';
}

export function smoothOrbLevel(previous, target, seconds) {
  const duration = target > previous ? .065 : .3;
  return previous + (target - previous) * (1 - Math.exp(-Math.max(0, seconds) / duration));
}

export function microphoneOrbScale(value) {
  const level = clamp(value);
  const points = [[0, 1], [.012, 1], [.045, 1.10], [.30, 1.125], [.80, 1.15], [1, 1.15]];
  for (let index = 1; index < points.length; index += 1) {
    const [end, scale] = points[index], [start, previous] = points[index - 1];
    if (level <= end) return previous + (scale - previous) * (level - start) / (end - start);
  }
  return 1.15;
}

// Approximately 100 ms to expand and 390 ms to settle through 95% of the release.
export function smoothOrbScale(previous, target, seconds) {
  const bounded = Math.min(1.15, Math.max(1, target));
  const duration = bounded > previous ? .04 : .13;
  const scale = previous + (bounded - previous) * (1 - Math.exp(-Math.max(0, seconds) / duration));
  return Math.min(1.15, Math.max(1, Math.abs(scale - bounded) < .0001 ? bounded : scale));
}

// A closed, smoothly interpolated contour. Low-amplitude waves retain a soft, rounded silhouette.
export function orbContour(time, amplitude = .0025) {
  const points = Array.from({ length: 24 }, (_, index) => {
    const angle = index / 24 * tau;
    const wave = .5 * Math.sin(angle * 2 + time * .43)
      + .32 * Math.sin(angle * 3 - time * .29 + 1.7)
      + .18 * Math.sin(angle * 5 + time * .37 + .8);
    const radius = .48 + Math.min(.016, Math.max(0, amplitude)) * wave;
    return [.5 + Math.cos(angle) * radius, .5 + Math.sin(angle) * radius];
  });
  const pair = point => point.map(value => value.toFixed(4)).join(' ');
  let path = `M ${pair(points[0])}`;
  for (let index = 0; index < points.length; index += 1) {
    const before = points[(index + 23) % 24], here = points[index];
    const next = points[(index + 1) % 24], after = points[(index + 2) % 24];
    const first = here.map((value, axis) => value + (next[axis] - before[axis]) / 6);
    const second = next.map((value, axis) => value - (after[axis] - here[axis]) / 6);
    path += ` C ${pair(first)} ${pair(second)} ${pair(next)}`;
  }
  return path + ' Z';
}

export function createVoiceOrb(stage) {
  const contour = stage.querySelector('#orb-contour');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let active = false, state = 'muted', activity = 'ready', micState = 'paused', microphone = 0, output = null, level = 0, activating = false, activationTime = 0;
  let frame = null, previous = 0, time = 0, age = 0, lastContour = -1;
  let scale = 1, glow = .2, deformation = .001;
  let flowRate = 0, flows = [];
  const baseGlow = { idle: .28, listening: .68, processing: .44, speaking: .52, muted: .18 };

  function cancel() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    previous = 0;
  }
  function write() {
    stage.style.setProperty('--orb-scale', scale.toFixed(4));
    stage.style.setProperty('--orb-glow', glow.toFixed(3));
    stage.style.setProperty('--orb-level', level.toFixed(3));
  }
  function staticFrame() {
    scale = 1; level = 0; glow = baseGlow[state];
    contour.setAttribute('d', orbContour(0, 0));
    write();
  }
  function tick(now) {
    frame = null;
    if (!active || document.hidden || reduced.matches) return;
    const elapsed = previous ? Math.max(0, (now - previous) / 1000) : 1 / 60;
    const delta = Math.min(.25, elapsed);
    previous = now;
    time += delta; age += delta;
    const target = state === 'listening' ? microphone : state === 'speaking' && output !== null ? output : 0;
    level = smoothOrbLevel(level, target, delta);
    let desiredScale = 1, desiredDeformation = .0005;
    if (state === 'idle') {
      desiredScale = 1.015 - .015 * Math.cos(tau * time / 4);
      desiredDeformation = .0025;
    } else if (state === 'listening') {
      desiredScale = microphoneOrbScale(microphone);
      desiredDeformation = .0025 + level * .0105;
    } else if (state === 'processing') {
      desiredScale = 1.006 + .004 * Math.sin(time * .71);
      desiredDeformation = .004;
    } else if (state === 'speaking') {
      if (output !== null) { desiredScale = 1 + level * .022; desiredDeformation = .0025 + level * .0105; }
      else {
        // Device speech synthesis has no PCM stream here; this fallback is not voice synchronization.
        desiredScale = 1.008 + .004 * Math.sin(time * .83) + .002 * Math.sin(time * 1.17);
        desiredDeformation = .005;
      }
    }
    if (activating && state === 'listening') {
      activationTime += delta;
      const progress = Math.max(0, Math.min(1, activationTime / .42));
      desiredScale = Math.max(desiredScale, 1 + .035 * Math.sin(progress * Math.PI));
    }
    const ease = 1 - Math.exp(-delta / .22);
    // This is the sole scale writer: speech, breathing and activation never multiply together.
    scale = smoothOrbScale(scale, desiredScale, elapsed);
    deformation += (desiredDeformation - deformation) * ease;
    const desiredGlow = baseGlow[state] + (state === 'listening' || state === 'speaking' && output !== null ? level * .35 : 0);
    glow += (desiredGlow - glow) * (1 - Math.exp(-delta / .28));
    flowRate += ((state === 'muted' ? 0 : 1) - flowRate) * (1 - Math.exp(-delta / .12));
    if (!flows.length) flows = [...stage.querySelectorAll('.orb-region')].flatMap(region => region.getAnimations());
    for (const flow of flows) flow.updatePlaybackRate(flowRate < .005 ? 0 : flowRate);
    write();
    // The small contour needs only 30 updates/second; colour layers use compositor transforms.
    if (time - lastContour >= 1 / 30) { contour.setAttribute('d', orbContour(time, deformation)); lastContour = time; }
    if (state === 'muted' && age > 1.4 && level < .002) { for (const flow of flows) flow.updatePlaybackRate(0); staticFrame(); return; }
    frame = requestAnimationFrame(tick);
  }
  function schedule() {
    stage.dataset.orbActive = String(active && !document.hidden);
    if (!active || document.hidden) { cancel(); return; }
    if (reduced.matches) { cancel(); staticFrame(); return; }
    if (frame === null) frame = requestAnimationFrame(tick);
  }
  function refreshState() {
    const next = micState === 'paused' || micState === 'error' ? 'muted'
      : micState === 'connecting' ? 'idle' : orbStateForVoice(activity);
    if (state !== next) { state = next; age = 0; }
    stage.dataset.orbState = state;
    stage.dataset.orbAudioSource = state === 'listening' ? 'microphone'
      : state === 'speaking' ? output === null ? 'state-animation' : 'output-audio' : 'none';
    schedule();
  }
  function setState(value) { activity = value; refreshState(); }
  function changedMotionPreference() { flows = []; schedule(); }
  reduced.addEventListener('change', changedMotionPreference);
  document.addEventListener('visibilitychange', schedule);
  setState(stage.dataset.state);
  return {
    setState,
    setActive(value) {
      active = Boolean(value);
      if (!active) { microphone = 0; output = null; level = 0; activating = false; cancel(); }
      schedule();
    },
    setMicLevel(value) { microphone = clamp(value); },
    setMicrophoneState(value) { micState = value; refreshState(); },
    setOutputLevel(value) { output = value === null ? null : clamp(value); if (state === 'speaking') stage.dataset.orbAudioSource = output === null ? 'state-animation' : 'output-audio'; },
    setActivation(value, delay = 0) { activating = Boolean(value); activationTime = -Math.max(0, delay); },
    dispose() { active = false; cancel(); reduced.removeEventListener('change', changedMotionPreference); document.removeEventListener('visibilitychange', schedule); },
  };
}
