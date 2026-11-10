import { simplexNoise } from './energy-field.js';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const fract = (value) => value - Math.floor(value);

function pixelCanvas(canvas) {
  const context = canvas.getContext('2d');
  const { width, height } = canvas.getBoundingClientRect();
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  context.setTransform(scale, 0, 0, scale, 0, 0);
  return { context, width, height };
}

function animateWhileVisible(element, active, draw) {
  let visible = false;
  let frame = 0;
  let last = 0;

  function update(time) {
    if (time - last >= 32) {
      draw(time, Math.min(time - last, 100));
      last = time;
    }
    frame = requestAnimationFrame(update);
  }

  function refresh() {
    cancelAnimationFrame(frame);
    frame = 0;
    if (!visible || !active()) return;
    draw(performance.now(), 0);
    if (!reducedMotion.matches) frame = requestAnimationFrame(update);
  }

  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    refresh();
  });
  observer.observe(element);
  reducedMotion.addEventListener('change', refresh);
  return refresh;
}

function animateRails(workspace, form) {
  const canvas = document.querySelector('#rails');
  let surface;
  let tracks = [];
  let interactive = false;
  let travel = 0;

  function draw(_, delta) {
    if (!surface) return;
    const { context, width, height } = surface;
    travel += delta * (interactive ? 0.00025 : 0.000075);
    context.clearRect(0, 0, width, height);
    context.lineWidth = 1;
    for (const { x, endX, y, endY, c1, c2, seed } of tracks) {
      context.strokeStyle = interactive ? '#80405160' : '#88435445';
      context.beginPath();
      context.moveTo(x, y);
      context.bezierCurveTo(c1, y, c2, endY, endX, endY);
      context.stroke();

      for (let index = 0; index < 3; index += 1) {
        const t = fract(travel * (0.85 + seed * 0.2) + seed + index / 3);
        const inverse = 1 - t;
        const px = inverse ** 3 * x + 3 * inverse ** 2 * t * c1 + 3 * inverse * t ** 2 * c2 + t ** 3 * endX;
        const py = y + (endY - y) * t * t * (3 - 2 * t);
        const bright = index === 0 || (interactive && index === 1);
        context.fillStyle = bright ? '#ff7891' : '#744251';
        context.globalAlpha = Math.min(1, t * 9, (1 - t) * 12);
        const size = bright ? 3 : 2;
        context.fillRect(Math.round(px), Math.round(py), size, size);
      }
      context.globalAlpha = 1;
    }
  }

  const active = () => workspace.dataset.view === 'welcome';
  const refresh = animateWhileVisible(workspace, active, draw);

  function layout() {
    if (!active()) {
      refresh();
      return;
    }
    const stage = canvas.getBoundingClientRect();
    const composer = form.getBoundingClientRect();
    surface = pixelCanvas(canvas);
    const centerY = composer.top - stage.top + composer.height / 2;
    const spread = Math.min(surface.height * 0.48, 320);
    const count = surface.width < 520 ? 6 : 8;

    tracks = [];
    for (const x of [0, surface.width]) {
      const endX = x === 0 ? composer.left - stage.left : composer.right - stage.left;
      if (Math.abs(x - endX) < 12) continue;
      for (let index = 0; index < count; index += 1) {
        const offset = (index / (count - 1)) * 2 - 1;
        const length = endX - x;
        tracks.push({
          x, endX,
          y: centerY + spread * offset,
          endY: centerY + offset * 13,
          c1: x + length * 0.47,
          c2: endX - length * 0.42,
          seed: fract(Math.sin(index * 18.3 + (x ? 44 : 18)) * 149.4),
        });
      }
    }
    refresh();
  }

  for (const event of ['pointerenter', 'focusin']) {
    form.addEventListener(event, () => { interactive = true; });
  }
  form.addEventListener('pointerleave', () => { interactive = form.matches(':focus-within'); });
  form.addEventListener('focusout', () => { interactive = form.matches(':hover'); });
  const resize = new ResizeObserver(layout);
  resize.observe(canvas);
  resize.observe(form);
  new MutationObserver(layout).observe(workspace, { attributeFilter: ['data-view'] });
  document.fonts.ready.then(layout);
  layout();
}

function animateCurtain() {
  const canvas = document.querySelector('#wordmark');
  const spacer = document.querySelector('#pixel-curtain');
  const text = 'WoiseX100';
  let surface;
  let backdrop;
  let dots = [];
  let size;

  function layout() {
    surface = pixelCanvas(canvas);
    const { width, height } = surface;
    if (!width || !height) return;
    const mask = document.createElement('canvas');
    mask.width = Math.ceil(width);
    mask.height = Math.ceil(height);
    const ctx = mask.getContext('2d', { willReadFrequently: true });
    let fontSize = height * 0.93;
    ctx.font = '640 ' + fontSize + 'px "Geist Mono", monospace';
    const lineWidth = ctx.measureText(text).width;
    if (lineWidth > width * 0.95) fontSize *= width * 0.95 / lineWidth;
    ctx.font = '640 ' + fontSize + 'px "Geist Mono", monospace';
    const metrics = ctx.measureText(text);
    const baseline = height / 2 + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
    ctx.textAlign = 'center';
    ctx.fillText(text, width / 2, baseline);
    const pixels = ctx.getImageData(0, 0, mask.width, mask.height).data;

    backdrop = document.createElement('canvas');
    backdrop.width = mask.width;
    backdrop.height = mask.height;
    const base = backdrop.getContext('2d');
    base.fillStyle = '#4a2431';
    const step = width < 500 ? 3 : 4;
    size = step - 1;
    dots = [];

    for (let y = 1; y < height; y += step) {
      for (let x = 1; x < width; x += step) {
        if (pixels[(Math.floor(y + size / 2) * mask.width + Math.floor(x + size / 2)) * 4 + 3] < 150) continue;
        if (x + size >= width || y + size >= height) continue;
        base.fillRect(x, y, size, size);
        const hash = fract(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453);
        if (hash > 0.61) dots.push({ x, y, hash });
      }
    }
    refresh();
  }

  function draw(time) {
    if (!surface || !backdrop) return;
    const { context, width, height } = surface;
    const phase = reducedMotion.matches ? 0.7 : time * 0.00038;
    context.clearRect(0, 0, width, height);
    context.drawImage(backdrop, 0, 0);
    for (const { x, y, hash } of dots) {
      const energy = simplexNoise(x * 0.0036 - phase, y * 0.003 + phase * 0.42);
      if (energy * 0.8 + hash * 0.2 < 0.68) continue;
      context.fillStyle = hash > 0.91 ? '#ff9cae' : hash > 0.76 ? '#ff5273' : '#b62d4e';
      context.fillRect(x, y, size, size);
    }
  }

  const refresh = animateWhileVisible(spacer, () => true, draw);
  new ResizeObserver(layout).observe(canvas);
  document.fonts.load('640 100px "Geist Mono"').then(layout, layout);
}

function rotateHeadline() {
  const accent = document.querySelector('#headline-accent');
  const phrases = ['tells my story.', 'answers as me.', 'talks shop.'];
  let index = 0;
  setInterval(() => {
    if (reducedMotion.matches || accent.offsetWidth === 0 || document.hidden) return;
    accent.classList.add('changing');
    setTimeout(() => {
      index = (index + 1) % phrases.length;
      accent.textContent = phrases[index];
      accent.classList.remove('changing');
    }, 180);
  }, 4300);
}

export function startMotion(workspace, form) {
  animateRails(workspace, form);
  animateCurtain();
  rotateHeadline();
}
