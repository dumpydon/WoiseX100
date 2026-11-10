import { simplexNoise } from "./energy-field.js";

// Glyph sampling and traveling field from DayPilot’s Limit X curtain.
function hash(x, y) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43_758.5453;
  return value - Math.floor(value);
}

/** Rasterize the wordmark once, retaining only grid cells that fall inside the glyph mask. */
function createDotCloud(width, height) {
  const mask = document.createElement("canvas");
  mask.width = Math.max(1, Math.round(width));
  mask.height = Math.max(1, Math.round(height));
  const context = mask.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas 2D context is unavailable");

  const wordmark = "WoiseX100";
  const maxWidth = width * 0.98;
  let fontSize = height * 0.85;
  const configuredFont = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-wordmark")
    .trim();
  const fontFamily = configuredFont || '"Times New Roman", Times, serif';
  context.font = `640 ${fontSize}px ${fontFamily}`;
  const metrics = context.measureText(wordmark);
  if (metrics.width > maxWidth) fontSize *= maxWidth / metrics.width;
  context.font = `640 ${fontSize}px ${fontFamily}`;

  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#fff";
  context.fillText(wordmark, width / 2, height / 2 + fontSize * 0.02);

  const pixels = context.getImageData(0, 0, mask.width, mask.height).data;
  // A 3px cell with a 1px gap, matching the reference curtain.
  const size = 3;
  const step = 4;
  const columns = Math.floor((width + 1) / step);
  const rows = Math.floor((height + 1) / step);
  const gridWidth = columns > 0 ? columns * size + (columns - 1) : 0;
  const gridHeight = rows > 0 ? rows * size + (rows - 1) : 0;
  const offsetX = Math.round((width - gridWidth) / 2);
  const offsetY = Math.round((height - gridHeight) / 2);
  const coordinates = [];
  const cells = [];
  const staticNoise = [];
  for (let row = 0; row < rows; row += 1) {
    const y = offsetY + row * step;
    for (let column = 0; column < columns; column += 1) {
      const x = offsetX + column * step;
      const pixelX = Math.min(mask.width - 1, Math.max(0, Math.round(x + size / 2)));
      const pixelY = Math.min(mask.height - 1, Math.max(0, Math.round(y + size / 2)));
      if (pixels[(pixelY * mask.width + pixelX) * 4 + 3] < 96) continue;
      coordinates.push(x, y);
      cells.push(column, row);
      staticNoise.push(hash(column, row));
    }
  }
  const count = staticNoise.length;
  return {
    width,
    height,
    step,
    size,
    count,
    positions: Float32Array.from(coordinates),
    cells: Uint16Array.from(cells),
    staticNoise: Float32Array.from(staticNoise),
  };
}

const IDLE = "rgba(255,255,255,.04)";
const ACCENT = "#ff506e";
const ACTIVE_THRESHOLD = 0.24;
const NOISE_SCALE = 0.002;
const NOISE_BLEND = 0.7;
const TRAVEL_SPEED = 0.5;

function drawFrame(context, cloud, elapsed) {
  context.clearRect(0, 0, cloud.width, cloud.height);
  context.fillStyle = IDLE;
  for (let index = 0; index < cloud.count; index += 1) {
    context.fillRect(
      cloud.positions[index * 2],
      cloud.positions[index * 2 + 1],
      cloud.size,
      cloud.size,
    );
  }

  context.fillStyle = ACCENT;
  const travel = elapsed * TRAVEL_SPEED;
  for (let index = 0; index < cloud.count; index += 1) {
    const noise = simplexNoise(
      cloud.cells[index * 2] * NOISE_SCALE + travel,
      cloud.cells[index * 2 + 1] * NOISE_SCALE + travel,
    );
    const threshold = cloud.staticNoise[index] * (1 - NOISE_BLEND) + noise * NOISE_BLEND;
    if (threshold >= ACTIVE_THRESHOLD) continue;
    context.fillRect(
      cloud.positions[index * 2],
      cloud.positions[index * 2 + 1],
      cloud.size,
      cloud.size,
    );
  }
}

export function startCurtainMotion(reducedMotion) {
  const canvas = document.querySelector("#wordmark");
  const section = canvas.parentElement;
  const context = canvas.getContext("2d");
  if (!context) return;

  let cloud;
  let frame = 0;
  let visible = false;
  let resizeTimer;
  let startedAt = 0;

  function render(timestamp) {
    drawFrame(context, cloud, timestamp / 1_000 - startedAt);
    if (visible && !reducedMotion.matches) frame = requestAnimationFrame(render);
  }

  function rebuild() {
    const bounds = section.getBoundingClientRect();
    const width = Math.max(320, bounds.width);
    const height = Math.max(204, bounds.height);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    cloud = createDotCloud(width, height);
    canvas.dataset.dotCount = String(cloud.count);
    canvas.dataset.gridStep = cloud.step.toFixed(2);
    canvas.dataset.cellSize = cloud.size.toFixed(2);
    canvas.dataset.dpr = dpr.toFixed(2);
    if (reducedMotion.matches) drawFrame(context, cloud, 8.25);
    else drawFrame(context, cloud, startedAt ? performance.now() / 1_000 - startedAt : 0);
  }

  function start() {
    if (frame || reducedMotion.matches) {
      if (reducedMotion.matches) canvas.dataset.animation = "reduced";
      return;
    }
    canvas.dataset.animation = "running";
    startedAt = performance.now() / 1_000;
    frame = requestAnimationFrame(render);
  }

  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    canvas.dataset.animation = "paused";
  }

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) start();
    else stop();
  }, { rootMargin: "200px" }).observe(section);

  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(rebuild, 120);
  }).observe(section);

  reducedMotion.addEventListener("change", () => {
    stop();
    rebuild();
    if (visible) start();
  });
  document.fonts.ready.then(rebuild);
  rebuild();
}
