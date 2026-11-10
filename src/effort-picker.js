export function createEffortPicker(root) {
  const toggle = root.querySelector('#effort-toggle');
  const panel = root.querySelector('#effort-panel');
  const slider = root.querySelector('#effort-slider');
  const rail = slider.querySelector('.effort-rail');
  const current = root.querySelector('#effort-current');
  const note = root.querySelector('#effort-note');
  const choices = [...root.querySelectorAll('input[name="effort"]')];
  const selected = () => choices.find((choice) => choice.checked);
  let dragPointer = null;

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
    endDrag();
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) toggle.focus({ preventScroll: true });
    return true;
  }

  function moveThumb(event) {
    const { left, width } = rail.getBoundingClientRect();
    const edge = 0.5 / choices.length;
    const progress = Math.max(edge, Math.min(1 - edge, (event.clientX - left) / width));
    slider.style.setProperty('--drag-position', `${progress * 100}%`);
    const choice = choices[Math.floor(progress * choices.length)];
    if (!choice.checked) {
      choice.checked = true;
      render();
    }
  }

  function endDrag() {
    if (dragPointer === null) return;
    const pointer = dragPointer;
    dragPointer = null;
    delete slider.dataset.dragging;
    slider.style.removeProperty('--drag-position');
    if (rail.hasPointerCapture(pointer)) rail.releasePointerCapture(pointer);
  }

  rail.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || dragPointer !== null) return;
    event.preventDefault();
    rail.setPointerCapture(event.pointerId);
    dragPointer = event.pointerId;
    slider.dataset.dragging = '';
    moveThumb(event);
  });
  rail.addEventListener('pointermove', (event) => {
    if (event.pointerId === dragPointer) moveThumb(event);
  });
  rail.addEventListener('pointerup', (event) => {
    if (event.pointerId !== dragPointer) return;
    moveThumb(event);
    endDrag();
    selected()?.focus({ preventScroll: true });
  });
  rail.addEventListener('lostpointercapture', (event) => {
    if (event.pointerId === dragPointer) endDrag();
  });

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
