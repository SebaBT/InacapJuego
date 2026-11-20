// Fires on finger contact instead of waiting for a clean tap (a click is dropped
// whenever the fingertip slides a few pixels), while keyboard, assistive and
// mouse activation still arrive through the regular click.
const clickGuardMs = 800;

export function bindTap(button, handler, { stopPropagation = false } = {}) {
  if (!button) return;
  let lastTouchAt = -Infinity;
  button.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' || event.button !== 0) return;
    event.preventDefault();
    if (button.disabled) return;
    lastTouchAt = performance.now();
    if (stopPropagation) event.stopPropagation();
    handler(event);
  });
  button.addEventListener('click', event => {
    if (stopPropagation) event.stopPropagation();
    if (event.detail > 0 && performance.now() - lastTouchAt < clickGuardMs) return;
    handler(event);
  });
  // Stop long-press menus and text selection from hijacking the press.
  for (const type of ['contextmenu', 'selectstart', 'dragstart']) {
    button.addEventListener(type, event => event.preventDefault());
  }
}
