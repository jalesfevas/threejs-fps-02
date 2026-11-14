// Keyboard and mouse, and the pointer lock that turns the mouse into look. Every event
// writes straight into the input snapshot in state.js: held keys, this-frame presses
// (movement, crouch, reload R, buy menu B, weapon slots 1/2/3, use E, grenade G), firing,
// and accumulated mouse deltas. Plain browser APIs only.
import { state } from './state.js';

export function createInput(canvas, onLockChange) {
  const input = state.input;

  function setKey(event, down) {
    if (down) {
      if (!event.repeat && !input.keys.has(event.code)) input.pressed.add(event.code);
      input.keys.add(event.code);
      if (event.code === 'Space' || event.code === 'Tab') event.preventDefault();
    } else {
      input.keys.delete(event.code);
    }
  }

  window.addEventListener('keydown', (event) => setKey(event, true));
  window.addEventListener('keyup', (event) => setKey(event, false));
  window.addEventListener('blur', () => {
    input.keys.clear();
    input.pressed.clear();
    input.firing = false;
  });
  window.addEventListener('mousemove', (event) => {
    if (!input.locked) return;
    input.lookX += event.movementX;
    input.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (!input.locked) return;
    if (event.button === 0) input.firing = true;
    if (event.button === 1) {
      input.pressed.add('MouseMiddle'); // grenade throw, same edge channel as keys
      event.preventDefault();
    }
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) input.firing = false;
  });
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
    if (!input.locked) {
      input.keys.clear();
      input.pressed.clear();
      input.firing = false;
    }
    onLockChange(input.locked);
  });

  // The reusable look delta, filled by takeLook so the frame loop allocates nothing.
  const lookDelta = { x: 0, y: 0 };
  return {
    requestLock() {
      canvas.requestPointerLock();
    },
    takeLook() {
      lookDelta.x = input.lookX;
      lookDelta.y = input.lookY;
      input.lookX = 0;
      input.lookY = 0;
      return lookDelta;
    },
  };
}
