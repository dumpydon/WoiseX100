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
  let active = false, state = 'muted', microphone = 0, level = 0, activating = false;
  let frame = null, previous = 0, time = 0, age = 0, lastContour = -1;
  let scale = 1, glow = .2, deformation = .001;
  const baseGlow = { idle: .45, listening: .58, processing: .54, speaking: .55, muted: .18 };

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
    const delta = previous ? Math.min(.05, (now - previous) / 1000) : 1 / 60;
    previous = now;
    time += delta; age += delta;
    const target = state === 'listening' && !activating ? microphone : 0;
    level = smoothOrbLevel(level, target, delta);
    let desiredScale = 1, desiredDeformation = .0005;
    if (state === 'idle') {
      desiredScale = 1.015 - .015 * Math.cos(tau * time / 4);
      desiredDeformation = .0025;
    } else if (state === 'listening') {
      desiredScale = 1 + level * .022 + .001 * Math.sin(time * .67);
      desiredDeformation = .0025 + level * .0105;
    } else if (state === 'processing') {
      desiredScale = 1.006 + .004 * Math.sin(time * .71);
      desiredDeformation = .004;
    } else if (state === 'speaking') {
      // Device speech synthesis exposes no PCM stream here. This is a restrained state animation.
      desiredScale = 1.008 + .004 * Math.sin(time * .83) + .002 * Math.sin(time * 1.17);
      desiredDeformation = .005;
    }
    const ease = 1 - Math.exp(-delta / .22);
    scale += (desiredScale - scale) * ease;
    deformation += (desiredDeformation - deformation) * ease;
    const desiredGlow = baseGlow[state] + (state === 'listening' ? level * .35 : 0);
    glow += (desiredGlow - glow) * (1 - Math.exp(-delta / .28));
    write();
    // The small contour needs only 30 updates/second; colour layers use compositor transforms.
    if (time - lastContour >= 1 / 30) { contour.setAttribute('d', orbContour(time, deformation)); lastContour = time; }
    if (state === 'muted' && age > 1.4 && level < .002) { staticFrame(); return; }
    frame = requestAnimationFrame(tick);
  }
  function schedule() {
    stage.dataset.orbActive = String(active && !document.hidden);
    if (!active || document.hidden) { cancel(); return; }
    if (reduced.matches) { cancel(); staticFrame(); return; }
    if (frame === null) frame = requestAnimationFrame(tick);
  }
  function setState(value) {
    const next = orbStateForVoice(value);
    if (state !== next) { state = next; age = 0; }
    stage.dataset.orbState = state;
    stage.dataset.orbAudioSource = state === 'listening' ? 'microphone'
      : state === 'speaking' ? 'state-animation' : 'none';
    schedule();
  }
  reduced.addEventListener('change', schedule);
  document.addEventListener('visibilitychange', schedule);
  setState(stage.dataset.state);
  return {
    setState,
    setActive(value) {
      active = Boolean(value);
      if (!active) { microphone = 0; level = 0; activating = false; cancel(); }
      schedule();
    },
    setMicLevel(value) { const next = clamp(value); microphone = next < .025 ? 0 : next; },
    setActivation(value) { activating = Boolean(value); },
    dispose() { active = false; cancel(); reduced.removeEventListener('change', schedule); document.removeEventListener('visibilitychange', schedule); },
  };
}
