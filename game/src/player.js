// First-person movement: acceleration and friction (never instant velocity), crouch, gravity,
// resolved as a vertical box against the world's colliders one axis at a time — with a modest
// step-up so stairs and low pads can be walked, a wall never swallows the player, and nothing
// is tunnelled at the 60 Hz step. All state lives in state.js. No jump: this is tactical.
import * as THREE from 'three';
import { state } from './state.js';

const RADIUS = 0.35;
const STAND_HEIGHT = 1.8;
const CROUCH_HEIGHT = 1.3;
const STAND_EYE = 1.7;
const CROUCH_EYE = 1.1;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;
const GROUND_ACCEL = 40;
const AIR_ACCEL = 8;
const FRICTION = 9;
const GRAVITY = 20;
const STEP_HEIGHT = 0.45; // walkable ledge: the 0.4 m courtyard steps, nothing taller
const MAX_FALL = 30;

export function createPlayer(colliders) {
  const player = state.player;
  const probe = new THREE.Box3();
  const wish = new THREE.Vector3();

  // lift keeps the feet and the crown out of the horizontal tests, so standing on the floor
  // is not read as walking into a wall.
  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - RADIUS, y + lift, z - RADIUS);
    probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
    return null;
  }

  function look(dx, dy, sensitivity = 0.0022) {
    player.yaw -= dx * sensitivity;
    player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    player.pitch = Math.min(1.45, player.pitch + pitchKick);
    player.yaw += yawKick;
  }

  // Try a horizontal move on one axis; if blocked, allow it as a step onto a ledge no
  // taller than STEP_HEIGHT (the ledge top becomes the new ground).
  function moveAxis(axis, delta) {
    if (delta === 0) return;
    const from = axis === 0 ? player.position.x : player.position.z;
    const next = from + delta;
    const hit = overlaps(
      axis === 0 ? next : player.position.x,
      player.position.y,
      axis === 0 ? player.position.z : next,
      player.height,
      0.04,
    );
    if (!hit) {
      if (axis === 0) player.position.x = next;
      else player.position.z = next;
      return;
    }
    const ledge = hit.max.y - player.position.y;
    if (ledge > 0 && ledge <= STEP_HEIGHT && !overlaps(
      axis === 0 ? next : player.position.x,
      hit.max.y,
      axis === 0 ? player.position.z : next,
      player.height,
      0.04,
    )) {
      if (axis === 0) player.position.x = next;
      else player.position.z = next;
      player.position.y = hit.max.y;
      player.onGround = true;
      player.velocity.y = 0;
    } else if (axis === 0) {
      player.velocity.x = 0;
    } else {
      player.velocity.z = 0;
    }
  }

  function step(dt) {
    const input = state.input;
    const crouching = input.keys.has('ControlLeft') || input.keys.has('ControlRight');
    if (crouching && !player.crouching) {
      player.crouching = true;
      player.height = CROUCH_HEIGHT;
    } else if (!crouching && player.crouching && !overlaps(player.position.x, player.position.y, player.position.z, STAND_HEIGHT, 0.02)) {
      player.crouching = false;
      player.height = STAND_HEIGHT;
    }
    const eyeTarget = player.crouching ? CROUCH_EYE : STAND_EYE;
    player.eye += (eyeTarget - player.eye) * Math.min(1, dt * 12);

    const forward = (input.keys.has('KeyW') ? 1 : 0) - (input.keys.has('KeyS') ? 1 : 0);
    const strafe = (input.keys.has('KeyD') ? 1 : 0) - (input.keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(player.yaw);
      const cos = Math.cos(player.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }

    const speed = player.crouching ? CROUCH_SPEED : WALK_SPEED;
    const blend = Math.min(1, (player.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / speed);
    player.velocity.x += (wish.x * speed - player.velocity.x) * blend;
    player.velocity.z += (wish.z * speed - player.velocity.z) * blend;
    if (player.onGround && !forward && !strafe) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      player.velocity.x *= damp;
      player.velocity.z *= damp;
    }

    player.velocity.y -= GRAVITY * dt;
    player.velocity.y = Math.max(-MAX_FALL, player.velocity.y);

    moveAxis(0, player.velocity.x * dt);
    moveAxis(2, player.velocity.z * dt);

    player.position.y += player.velocity.y * dt;
    player.onGround = false;
    const hit = overlaps(player.position.x, player.position.y, player.position.z, player.height, 0);
    if (hit && player.velocity.y <= 0) {
      player.position.y = hit.max.y;
      player.velocity.y = 0;
      player.onGround = true;
    } else if (hit) {
      player.position.y = hit.min.y - player.height;
      player.velocity.y = 0;
    }
    if (player.position.y < 0) {
      player.position.y = 0;
      player.velocity.y = 0;
      player.onGround = true;
    }
  }

  return {
    state: player,
    step,
    look,
    recoil,
    groundSpeed() {
      return Math.hypot(player.velocity.x, player.velocity.z);
    },
  };
}
