// Distances are fractions of the pad radius, independent of screen size.
// Running lives on its own button, so the pad only has to steer.
const deadZone = 0.1;
const fullSpeedEdge = 0.55;
const lookDirectionReach = 0.45;

export function bindTouchStick(element, { isActive, onPress, onDirection }) {
  const thumb = element.firstElementChild;
  const input = { x: 0, y: 0, held: false, reset };
  const win = globalThis.window;
  let pointerId = null, lastDirection = null;

  function readPointer(event) {
    const rect = element.getBoundingClientRect();
    const radius = Math.min(rect.width, rect.height) / 2;
    if (!radius) return;
    const dx = event.clientX - rect.left - rect.width / 2;
    const dy = event.clientY - rect.top - rect.height / 2;
    const distance = Math.hypot(dx, dy);
    const reach = distance / radius;
    const unitX = distance ? dx / distance : 0;
    const unitY = distance ? dy / distance : 0;
    const speed = Math.max(0, Math.min(1, (reach - deadZone) / (fullSpeedEdge - deadZone)));
    input.x = unitX * speed;
    input.y = unitY * speed;

    // The thumb stays inside the ring; dragging past it keeps steering at full speed.
    const travel = radius * Math.min(reach, 1) * 0.8;
    thumb.style.transform = `translate(${unitX * travel}px,${unitY * travel}px) rotate(${Math.atan2(dy, dx)}rad)`;
    element.classList.toggle('pushing', reach >= 1);

    if (reach <= 0.22) lastDirection = null;
    if (reach < lookDirectionReach) return;
    let direction;
    if (Math.abs(dx) > 1.35 * Math.abs(dy)) direction = dx > 0 ? 'KeyD' : 'KeyA';
    if (Math.abs(dy) > 1.35 * Math.abs(dx)) direction = dy > 0 ? 'KeyS' : 'KeyW';
    if (direction && direction !== lastDirection) {
      lastDirection = direction;
      onDirection?.(direction);
    }
  }

  function release() {
    const id = pointerId;
    pointerId = null;
    input.x = input.y = 0;
    input.held = false;
    lastDirection = null;
    if (id !== null && element.hasPointerCapture?.(id)) element.releasePointerCapture(id);
    element.classList.remove('pushing');
    thumb.style.transform = 'translate(0px,0px)';
  }

  function reset() {
    release();
    onDirection?.(null);
  }

  element.addEventListener('pointerdown', event => {
    if (!isActive() || event.button !== 0) return;
    // A second finger never steals a live drag, but a stale id (a lift the page
    // never heard about) must not leave the pad dead or the character walking.
    if (pointerId !== null && element.hasPointerCapture?.(pointerId)) return;
    if (pointerId !== null) release();
    event.preventDefault?.();
    onPress();
    pointerId = event.pointerId;
    input.held = true;
    element.setPointerCapture(pointerId);
    readPointer(event);
  });
  element.addEventListener('pointermove', event => {
    if (event.pointerId === pointerId) readPointer(event);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    element.addEventListener(type, event => {
      if (event.pointerId !== pointerId) return;
      if (type === 'pointerup') release();
      else reset();
    });
  }

  // Safety nets so a missed pointer event can never leave the pad stuck.
  for (const type of ['pointerup', 'pointercancel']) {
    win?.addEventListener(type, event => {
      if (pointerId !== null && event.pointerId === pointerId) reset();
    });
  }
  for (const type of ['touchend', 'touchcancel']) {
    win?.addEventListener(type, event => {
      if (pointerId !== null && event.touches && event.touches.length === 0) reset();
    }, { passive: true });
  }
  // Long-press menus, text selection and drag ghosts steal the finger mid-drag.
  for (const type of ['contextmenu', 'selectstart', 'dragstart']) {
    element.addEventListener(type, event => event.preventDefault());
  }
  element.addEventListener('touchstart', event => event.cancelable && event.preventDefault(), { passive: false });
  return input;
}
