export function createEffortPicker(root) {
  const toggle = root.querySelector('#effort-toggle');
  const panel = root.querySelector('#effort-panel');
  const slider = root.querySelector('#effort-slider');
  const current = root.querySelector('#effort-current');
  const note = root.querySelector('#effort-note');
  const choices = [...root.querySelectorAll('input[name="effort"]')];
  const selected = () => choices.find((choice) => choice.checked);

  function render() {
    const choice = selected();
    if (!choice) return;
    const label = choice.labels[0].textContent.trim();
    slider.dataset.level = String(choices.indexOf(choice));
    current.textContent = label;
    toggle.setAttribute('aria-label', `Thinking effort, ${label}`);
  }

  function close(restoreFocus = false) {
    if (panel.hidden) return false;
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) toggle.focus({ preventScroll: true });
    return true;
  }

  toggle.addEventListener('click', () => {
    if (close()) return;
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    selected()?.focus({ preventScroll: true });
  });
  panel.addEventListener('change', render);
  document.addEventListener('pointerdown', (event) => {
    if (!root.contains(event.target)) close();
  });

  return {
    configure(live) {
      toggle.disabled = false;
      if (!live) note.textContent = 'Effort applies when live replies are connected.';
      render();
    },
    get value() { return selected()?.value; },
    close,
  };
}
