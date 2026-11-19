// Distances are fractions of the pad radius, independent of screen size.
const deadZone = 0.12;
const walkEdge = 0.48;
const innerRing = 0.74;
const sprintEngage = 1.50;
const sprintRelease = 1.08;

export function bindTouchStick(element, { isActive, onPress, onDirection }) {
  const thumb = element.firstElementChild;
  const input = { x: 0, y: 0, wantsSprint: false, reset };
  let pointerId = null, lastDirection = null, armed = false;
  element.style.setProperty('--sprint-overtravel', String(sprintEngage - 1));

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
    const speed = Math.max(0, Math.min(1, (reach - deadZone) / (walkEdge - deadZone)));
    input.x = unitX * speed;
    input.y = unitY * speed;

    if (reach <= innerRing) armed = true;
    input.wantsSprint = armed && reach >= (input.wantsSprint ? sprintRelease : sprintEngage);

    // Progressively less thumb travel per pixel until the finger pushes past the detent.
    const load = Math.max(0, Math.min(1, (reach - walkEdge) / (sprintEngage - walkEdge)));
    const compressed = Math.min(reach, walkEdge) + 0.12 * load * (2 - load);
    const travel = radius * (input.wantsSprint ? innerRing : compressed);
    const squeeze = input.wantsSprint ? 0 : load;
    thumb.style.transform =
      `translate(${unitX * travel}px,${unitY * travel}px) ` +
      `rotate(${Math.atan2(dy, dx)}rad) ` +
      `scale(${1 - 0.18 * squeeze},${1 + 0.06 * squeeze})`;
    element.classList.toggle('pushing', armed && reach >= 1);

    if (reach <= 0.22) lastDirection = null;
    if (reach < 0.45) return;
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
    armed = false;
    input.wantsSprint = false;
    lastDirection = null;
    if (id !== null && element.hasPointerCapture(id)) element.releasePointerCapture(id);
    element.classList.remove('pushing', 'running');
    thumb.style.transform = 'translate(0px,0px)';
  }

  function reset() {
    release();
    onDirection?.(null);
  }

  element.addEventListener('pointerdown', event => {
    if (!isActive() || pointerId !== null || event.button !== 0) return;
    onPress();
    pointerId = event.pointerId;
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
  return input;
}
