// Bomb visuals, pure three.js primitives driven by state.round.bomb: the planted bomb is a
// small dark box with a blinking red point light; the carried indicator is a small box that
// rides the carrier's back; a dropped bomb glows so it can be spotted across the yard.
import * as THREE from 'three';
import { state } from './state.js';

let planted = null;
let light = null;
let carried = null;
let dropped = null;

export function initBombs(scene) {
  planted = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.22, 0.24),
    new THREE.MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.4 }),
  );
  light = new THREE.PointLight(0xff2a1a, 0, 7);
  light.position.y = 0.5;
  planted.add(light);
  scene.add(planted);

  carried = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.2, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x8a2a1a, roughness: 0.5 }),
  );
  scene.add(carried);

  dropped = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.22, 0.24),
    new THREE.MeshStandardMaterial({ color: 0x2a2016, emissive: 0xf0a830, emissiveIntensity: 0.7 }),
  );
  scene.add(dropped);

  planted.visible = false;
  carried.visible = false;
  dropped.visible = false;
}

// The carrier's position and yaw: 'player' or an index into state.bots.
function carrierRef() {
  const bomb = state.round.bomb;
  if (bomb.carrier === 'player') {
    return state.player.alive ? { pos: state.player.position, yaw: state.player.yaw } : null;
  }
  if (typeof bomb.carrier === 'number') {
    const bot = state.bots[bomb.carrier];
    return bot && bot.alive ? { pos: bot.position, yaw: bot.yaw } : null;
  }
  return null;
}

export function updateBombs() {
  const bomb = state.round.bomb;
  if (bomb.state === 'planted') {
    planted.visible = true;
    planted.position.set(bomb.x, bomb.y + 0.11, bomb.z);
    // Blink: 2 Hz square wave, faster in the last seconds before detonation.
    const hz = bomb.timer < 5 ? 5 : 2;
    light.intensity = Math.sin(state.time * Math.PI * hz) > 0 ? 3 : 0.2;
  } else {
    planted.visible = false;
    light.intensity = 0;
  }
  dropped.visible = bomb.state === 'dropped';
  if (dropped.visible) dropped.position.set(bomb.x, bomb.y + 0.11, bomb.z);
  const ref = bomb.state === 'carried' ? carrierRef() : null;
  carried.visible = Boolean(ref);
  if (ref) {
    // Behind the carrier: the facing vector is (-sin yaw, -cos yaw), so back is its negation.
    carried.position.set(
      ref.pos.x + Math.sin(ref.yaw) * 0.42,
      ref.pos.y + 0.95,
      ref.pos.z + Math.cos(ref.yaw) * 0.42,
    );
    carried.rotation.y = ref.yaw;
  }
}
