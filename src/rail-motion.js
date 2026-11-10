// DayPilot HeroFlowCanvas geometry and animation, with the WoiseX100 accent.
const ACCENT = "#ff506e";

const FLOW_CONFIG = {
  pathCount: 8,
  dotsPerPath: 3,
  dotSize: 1.5,
  primaryDotRatio: 0.25,
  startSpread: 1,
  finishSpread: 0.04,
  curvature: 0.5,
  idleSpeed: 0.2,
  interactiveSpeed: 4.8,
  resizeDebounceMs: 120,
  pathColor: "rgba(255, 255, 255, 0.24)",
  secondaryColor: "#252525",
};

const FLOW_SEED = 17;

function fract(value) {
  return value - Math.floor(value);
}

function seeded(value) {
  return fract(Math.sin(value * 127.1 + 311.7) * 43_758.5453);
}

function bezierPoint(progress, path) {
  const inverse = 1 - progress;
  const inverseSquared = inverse * inverse;
  const progressSquared = progress * progress;
  return {
    x: inverseSquared * inverse * path.p0.x
      + 3 * inverseSquared * progress * path.p1.x
      + 3 * inverse * progressSquared * path.p2.x
      + progressSquared * progress * path.p3.x,
    y: inverseSquared * inverse * path.p0.y
      + 3 * inverseSquared * progress * path.p1.y
      + 3 * inverse * progressSquared * path.p2.y
      + progressSquared * progress * path.p3.y,
  };
}

function arcPath(bezier) {
  const lookup = new Float64Array(65);
  let previous = bezier.p0;
  for (let index = 1; index <= 64; index += 1) {
    const point = bezierPoint(index / 64, bezier);
    const dx = point.x - previous.x;
    const dy = point.y - previous.y;
    lookup[index] = lookup[index - 1] + Math.sqrt(dx * dx + dy * dy);
    previous = point;
  }
  const length = lookup[64];
  if (length > 0) {
    for (let index = 1; index <= 64; index += 1) lookup[index] /= length;
  }
  return { bezier, lookup, length };
}

/** Recreate Explee's measured S-curve: wide starts, narrow field-side finish. */
function createBezierPath(
  index,
  width,
  height,
  mirrored,
) {
  const normalized = (index - (FLOW_CONFIG.pathCount - 1) / 2) / ((FLOW_CONFIG.pathCount - 1) / 2);
  const startY = height / 2 + height / 2 * normalized * FLOW_CONFIG.startSpread;
  const finishY = height / 2 + height / 2 * normalized * FLOW_CONFIG.finishSpread;
  const startX = mirrored ? width : 0;
  const finishX = mirrored ? 0 : width;
  const controlOneX = mirrored
    ? startX - width * FLOW_CONFIG.curvature
    : startX + width * FLOW_CONFIG.curvature;
  const controlTwoX = mirrored
    ? finishX + width * FLOW_CONFIG.curvature
    : finishX - width * FLOW_CONFIG.curvature;
  return {
    p0: { x: startX, y: startY },
    p1: { x: controlOneX, y: startY },
    p2: { x: controlTwoX, y: finishY },
    p3: { x: finishX, y: finishY },
  };
}

function pointAtArc(path, progress) {
  if (progress <= 0) return path.bezier.p0;
  if (progress >= 1) return path.bezier.p3;
  let low = 0;
  let high = path.lookup.length - 1;
  while (low < high - 1) {
    const middle = (low + high) >> 1;
    if (path.lookup[middle] < progress) low = middle;
    else high = middle;
  }
  const span = path.lookup[high] - path.lookup[low];
  const local = span < 1e-10 ? 0 : (progress - path.lookup[low]) / span;
  return bezierPoint((low + local) / (path.lookup.length - 1), path.bezier);
}

function createSidePaths(
  width,
  height,
  offsetX,
  offsetY,
  mirrored,
) {
  return Array.from({ length: FLOW_CONFIG.pathCount }, (_, index) => {
    const source = createBezierPath(index, width, height, mirrored);
    const translated = {
      p0: { x: source.p0.x + offsetX, y: source.p0.y + offsetY },
      p1: { x: source.p1.x + offsetX, y: source.p1.y + offsetY },
      p2: { x: source.p2.x + offsetX, y: source.p2.y + offsetY },
      p3: { x: source.p3.x + offsetX, y: source.p3.y + offsetY },
    };
    return arcPath(translated);
  });
}

function createDots(pathCount, sideIndex) {
  const dots = [];
  for (let pathIndex = 0; pathIndex < pathCount; pathIndex += 1) {
    const midpoint = (pathCount - 1) / 2;
    const duration = 3 + Math.abs(pathIndex - midpoint) / midpoint;
    for (let dotIndex = 0; dotIndex < FLOW_CONFIG.dotsPerPath; dotIndex += 1) {
      const pathSeed = FLOW_SEED + sideIndex * 10_000 + pathIndex;
      const startOffset = seeded(pathSeed * 200 + dotIndex + 500);
      const delay = 2 * seeded(pathSeed * 100 + dotIndex);
      const isPrimary = seeded(pathSeed * 300 + dotIndex + 1_000) < FLOW_CONFIG.primaryDotRatio;
      dots.push({
        pathIndex: sideIndex * pathCount + pathIndex,
        isPrimary,
        color: isPrimary ? ACCENT : FLOW_CONFIG.secondaryColor,
        duration,
        delayRemaining: delay * 1_000,
        virtualTime: startOffset * duration * 1_000,
        initialFade: 0,
      });
    }
  }
  return dots;
}

function drawFlow(
  context,
  state,
  width,
  height,
  deltaMs,
  interactive,
  reducedMotion,
) {
  context.clearRect(0, 0, width, height);
  context.lineWidth = 1;
  context.lineCap = "round";
  context.strokeStyle = FLOW_CONFIG.pathColor;
  context.globalAlpha = 0.16;
  for (const path of state.paths) {
    context.beginPath();
    context.moveTo(path.bezier.p0.x, path.bezier.p0.y);
    context.bezierCurveTo(
      path.bezier.p1.x,
      path.bezier.p1.y,
      path.bezier.p2.x,
      path.bezier.p2.y,
      path.bezier.p3.x,
      path.bezier.p3.y,
    );
    context.stroke();
  }

  const speed = reducedMotion
    ? 0
    : (interactive ? FLOW_CONFIG.interactiveSpeed : FLOW_CONFIG.idleSpeed);
  const dotDiameter = FLOW_CONFIG.dotSize * 2;
  for (const primaryPass of [false, true]) {
    for (const dot of state.dots) {
      if (dot.isPrimary !== primaryPass) continue;
      if (dot.delayRemaining > 0) {
        if (!reducedMotion) dot.delayRemaining = Math.max(0, dot.delayRemaining - deltaMs);
        continue;
      }
      dot.initialFade = reducedMotion ? 1 : Math.min(1, dot.initialFade + deltaMs / 300);
      dot.virtualTime += deltaMs * speed;
      const cycleMs = dot.duration * 1_000;
      const progress = ((dot.virtualTime % cycleMs) + cycleMs) % cycleMs / cycleMs;
      let fade = 1;
      if (progress < 0.05) fade = progress / 0.05;
      else if (progress > 0.95) fade = (1 - progress) / 0.05;
      const alpha = fade * dot.initialFade;
      if (alpha <= 0) continue;
      const path = state.paths[dot.pathIndex];
      if (!path) continue;
      const point = pointAtArc(path, progress);
      context.globalAlpha = alpha;
      context.fillStyle = dot.color;
      context.fillRect(
        point.x - FLOW_CONFIG.dotSize,
        point.y - FLOW_CONFIG.dotSize,
        dotDiameter,
        dotDiameter,
      );
    }
  }
  context.globalAlpha = 1;
}

export function startRailMotion(workspace, form, reducedMotion) {
  const canvas = document.querySelector("#rails");
  const stage = canvas.parentElement;
  const context = canvas.getContext("2d");
  if (!context) return;

  let state;
  let width;
  let height;
  let frame = 0;
  let resizeTimer;
  let lastTimestamp = 0;
  let hovered = false;
  let focused = false;

  function render(timestamp) {
    const delta = lastTimestamp ? Math.min(64, timestamp - lastTimestamp) : 16;
    lastTimestamp = timestamp;
    drawFlow(context, state, width, height, delta, hovered || focused, false);
    frame = requestAnimationFrame(render);
  }

  function rebuild() {
    cancelAnimationFrame(frame);
    frame = 0;
    if (workspace.dataset.view !== "welcome" || !canvas.clientHeight) return;

    const field = form.getBoundingClientRect();
    const stageBounds = stage.getBoundingClientRect();
    canvas.style.top = Math.round(field.top + field.height / 2 - stageBounds.top - canvas.clientHeight / 2) + "px";

    const bounds = canvas.getBoundingClientRect();
    width = bounds.width;
    height = bounds.height;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    const leftWidth = Math.max(0, field.left - bounds.left);
    const rightWidth = Math.max(0, bounds.right - field.right);
    const verticalOffset = field.top + field.height / 2 - bounds.top - height / 2;
    state = {
      paths: [
        ...createSidePaths(leftWidth, height, 0, verticalOffset, false),
        ...createSidePaths(rightWidth, height, width - rightWidth, verticalOffset, true),
      ],
      dots: [...createDots(FLOW_CONFIG.pathCount, 0), ...createDots(FLOW_CONFIG.pathCount, 1)],
    };

    if (reducedMotion.matches) {
      drawFlow(context, state, width, height, 0, false, true);
      return;
    }
    lastTimestamp = 0;
    frame = requestAnimationFrame(render);
  }

  form.addEventListener("pointerenter", () => { hovered = true; });
  form.addEventListener("pointerleave", () => { hovered = false; });
  form.addEventListener("focusin", () => { focused = true; });
  form.addEventListener("focusout", (event) => { focused = form.contains(event.relatedTarget); });
  const resize = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(rebuild, FLOW_CONFIG.resizeDebounceMs);
  });
  resize.observe(stage);
  resize.observe(form);
  new MutationObserver(rebuild).observe(workspace, { attributeFilter: ["data-view"] });
  reducedMotion.addEventListener("change", rebuild);
  document.fonts.ready.then(rebuild);
  rebuild();
}
