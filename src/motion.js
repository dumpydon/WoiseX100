import { startRailMotion } from "./rail-motion.js";
import { startCurtainMotion } from "./curtain-motion.js";

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

function rotateHeadline() {
  const accent = document.querySelector('#headline-accent');
  const phrases = [accent.textContent, 'Explore my work.', 'See how I think.'];
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
  startRailMotion(workspace, form, reducedMotion);
  startCurtainMotion(reducedMotion);
  rotateHeadline();
}
