// The arsenal: three weapons defined once in the WEAPONS table, one hitscan pipeline, pooled
// tracers and impact puffs, and the low-poly viewmodels. The fixed step drives everything here:
// fire rate is the accumulated cooldown, never a frame count. Ammunition and timers live in
// state.weapon; the pools hang off state.fx so there is a single home for mutable state.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { state } from './state.js';
import { damagePlayer } from './player.js';

// name, magazine, reserve, body/head damage, rounds per minute, reload seconds, spread standing
// vs moving (radians, at the 5.2 m/s walk reference), recoil per shot, viewmodel muzzle offset.
export const WEAPONS = [
  { name: 'Kiln-9', mag: 30, reserve: 90, damageBody: 25, damageHead: 100, rpm: 600, reload: 2.2, spreadStill: 0.0022, spreadMove: 0.03, recoilUp: 0.011, recoilSide: 0.006, kick: 0.05, muzzle: [0.24, -0.18, -0.95] },
  { name: 'Ember', mag: 25, reserve: 125, damageBody: 16, damageHead: 100, rpm: 900, reload: 1.8, spreadStill: 0.006, spreadMove: 0.05, recoilUp: 0.007, recoilSide: 0.004, kick: 0.035, muzzle: [0.22, -0.17, -0.8] },
  { name: 'Judge', mag: 12, reserve: 48, damageBody: 30, damageHead: 120, rpm: 240, reload: 1.4, spreadStill: 0.0015, spreadMove: 0.04, recoilUp: 0.02, recoilSide: 0.008, kick: 0.07, muzzle: [0.2, -0.2, -0.62] },
];
for (const weapon of WEAPONS) weapon.fireGap = 60 / weapon.rpm;

const MOVE_REFERENCE = 5.2; // walk speed: full movement spread at this ground speed
const FLASH_TIME = 0.06;
const RECOIL_RESET = 0.35; // seconds without a shot before the recoil pattern restarts
const SWITCH_TIME = 0.4;
const TRACER_COUNT = 10;
const TRACER_TIME = 0.07;
const PUFF_COUNT = 96;
const RANGE = 100;

export function createWeapons(camera, scene, opts) {
  const applyDamage = opts.applyDamage;
  const recoil = opts.recoil;
  const random = opts.random ?? Math.random;
  const shootables = opts.shootables;

  const weapon = state.weapon;

  // --- Pools (built once, then mutated in place) ------------------------------------------
  const puff = {
    cursor: 0,
    life: new Float32Array(PUFF_COUNT),
    velocity: new Float32Array(PUFF_COUNT * 3),
    geometry: new THREE.BufferGeometry(),
  };
  const puffPositions = new Float32Array(PUFF_COUNT * 3);
  for (let i = 0; i < PUFF_COUNT; i += 1) puffPositions[i * 3 + 1] = -100;
  puff.geometry.setAttribute('position', new THREE.BufferAttribute(puffPositions, 3));
  const puffPoints = new THREE.Points(puff.geometry, new THREE.PointsMaterial({
    color: new THREE.Color(PALETTE.ink), size: 0.07, transparent: true, opacity: 0.9,
    depthWrite: false, sizeAttenuation: true,
  }));
  puffPoints.frustumCulled = false;
  scene.add(puffPoints);
  state.fx.puff = puff;

  const tracerMaterial = () => new THREE.LineBasicMaterial({
    color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0, depthWrite: false,
  });
  const tracers = [];
  for (let i = 0; i < TRACER_COUNT; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geometry, tracerMaterial());
    line.frustumCulled = false;
    line.visible = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  state.fx.tracers = tracers;

  // --- Viewmodels: own low-poly boxes and cylinders, one group per weapon ------------------
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const metal = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const amber = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.4, metalness: 0.1 });

  function part(group, geometry, material, x, y, z, rx = 0) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    group.add(mesh);
    return mesh;
  }

  // Kiln-9: long receiver, slim barrel, stocked shoulder, slight magazine rake.
  const rifle = new THREE.Group();
  part(rifle, new THREE.BoxGeometry(0.09, 0.1, 0.42), metal, 0, 0, 0);
  part(rifle, new THREE.BoxGeometry(0.045, 0.045, 0.5), dark, 0, 0.02, -0.42);
  part(rifle, new THREE.BoxGeometry(0.075, 0.09, 0.22), dark, 0, -0.02, 0.3);
  part(rifle, new THREE.BoxGeometry(0.06, 0.16, 0.09), dark, 0, -0.13, -0.04, 0.18);
  part(rifle, new THREE.CylinderGeometry(0.012, 0.012, 0.06, 8), amber, 0, 0.07, -0.1);
  // Ember: stubby body, fat cooling shroud, long straight magazine.
  const smg = new THREE.Group();
  part(smg, new THREE.BoxGeometry(0.09, 0.11, 0.3), metal, 0, 0, 0);
  part(smg, new THREE.CylinderGeometry(0.03, 0.03, 0.26, 10), dark, 0, 0.01, -0.26, Math.PI / 2);
  part(smg, new THREE.BoxGeometry(0.05, 0.09, 0.12), dark, 0, -0.01, 0.2);
  part(smg, new THREE.BoxGeometry(0.055, 0.22, 0.08), dark, 0, -0.16, 0.02);
  part(smg, new THREE.BoxGeometry(0.02, 0.05, 0.02), amber, 0, 0.08, -0.08);
  // Judge: short slide over a raked grip, visible hammer notch.
  const pistol = new THREE.Group();
  part(pistol, new THREE.BoxGeometry(0.055, 0.06, 0.26), metal, 0, 0.03, -0.05);
  part(pistol, new THREE.BoxGeometry(0.05, 0.13, 0.07), dark, 0, -0.06, 0.04, 0.28);
  part(pistol, new THREE.BoxGeometry(0.03, 0.03, 0.05), dark, 0, 0.065, 0.06);
  part(pistol, new THREE.CylinderGeometry(0.011, 0.011, 0.05, 8), amber, 0, 0.03, -0.2, Math.PI / 2);

  const models = [rifle, smg, pistol];
  // Viewmodel scale: smaller and pushed right-down so the weapon never covers a target.
  const VM_SCALE = 0.7;
  const basePos = [
    new THREE.Vector3(0.30, -0.27, -0.42),
    new THREE.Vector3(0.28, -0.26, -0.36),
    new THREE.Vector3(0.26, -0.29, -0.34),
  ];
  for (let i = 0; i < models.length; i += 1) {
    models[i].position.copy(basePos[i]);
    models[i].scale.setScalar(VM_SCALE);
    models[i].visible = i === weapon.slot;
    camera.add(models[i]);
  }

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  camera.add(flashLight);

  // --- Reused temporaries: the hot loop allocates nothing ---------------------------------
  const direction = new THREE.Vector3();
  const origin = new THREE.Vector3();
  const endPoint = new THREE.Vector3();
  const muzzlePoint = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  raycaster.far = RANGE;

  function currentSpread() {
    const rec = WEAPONS[weapon.slot];
    const speed = Math.hypot(state.player.velocity.x, state.player.velocity.z);
    return rec.spreadStill + Math.min(1, speed / MOVE_REFERENCE) * rec.spreadMove;
  }

  function reload() {
    const rec = WEAPONS[weapon.slot];
    const slot = weapon.slots[weapon.slot];
    if (weapon.switchLeft > 0 || slot.reloadLeft > 0 || slot.mag === rec.mag || slot.reserve === 0) return;
    slot.reloadLeft = rec.reload;
  }

  function switchTo(index) {
    if (index === weapon.slot || index < 0 || index >= WEAPONS.length) return;
    weapon.slots[weapon.slot].reloadLeft = 0; // switching cancels an in-flight reload
    weapon.slot = index;
    weapon.switchLeft = SWITCH_TIME;
  }

  function spawnPuff(point, count, speed) {
    const positions = puff.geometry.attributes.position.array;
    for (let n = 0; n < count; n += 1) {
      const i = puff.cursor;
      puff.cursor = (puff.cursor + 1) % PUFF_COUNT;
      positions[i * 3] = point.x + (random() - 0.5) * 0.06;
      positions[i * 3 + 1] = point.y + (random() - 0.5) * 0.06;
      positions[i * 3 + 2] = point.z + (random() - 0.5) * 0.06;
      const theta = random() * Math.PI * 2;
      const rise = random() * 0.8;
      puff.velocity[i * 3] = Math.cos(theta) * speed * (0.3 + random() * 0.7);
      puff.velocity[i * 3 + 1] = rise * speed;
      puff.velocity[i * 3 + 2] = Math.sin(theta) * speed * (0.3 + random() * 0.7);
      puff.life[i] = 0.28 + random() * 0.22;
    }
    puff.geometry.attributes.position.needsUpdate = true;
  }

  function spawnTracer(from, to) {
    let oldest = tracers[0];
    for (const tracer of tracers) if (tracer.life < oldest.life) oldest = tracer;
    const attribute = oldest.line.geometry.attributes.position;
    attribute.array[0] = from.x; attribute.array[1] = from.y; attribute.array[2] = from.z;
    attribute.array[3] = to.x; attribute.array[4] = to.y; attribute.array[5] = to.z;
    attribute.needsUpdate = true;
    oldest.life = TRACER_TIME;
    oldest.line.visible = true;
  }

  // One round: rate-of-fire gate, empty-mag auto reload, recoil pattern, hitscan, impact.
  function tryFire(spread) {
    const rec = WEAPONS[weapon.slot];
    const slot = weapon.slots[weapon.slot];
    if (!state.player.alive) return false; // spectating: no firing
    if (weapon.switchLeft > 0 || slot.reloadLeft > 0 || slot.cooldown > 0) return false;
    if (slot.mag <= 0) {
      reload(); // dry trigger feeds a fresh magazine
      return false;
    }
    slot.cooldown = rec.fireGap;
    slot.mag -= 1;
    weapon.flash = FLASH_TIME;
    weapon.kick = rec.kick;

    // Recoil pattern: the first shots climb, then the climb eases and the group drifts right.
    const index = slot.recoilIndex;
    const climb = rec.recoilUp * (index < 6 ? 1 : 0.45);
    const drift = index < 4
      ? (random() * 2 - 1) * rec.recoilSide * 0.3
      : rec.recoilSide * Math.min(1, (index - 3) / 8);
    slot.recoilIndex = index + 1;
    slot.lastShot = state.time;
    recoil(climb, -drift);

    origin.copy(camera.position);
    camera.getWorldDirection(direction);
    direction.x += (random() * 2 - 1) * spread;
    direction.y += (random() * 2 - 1) * spread;
    direction.z += (random() * 2 - 1) * spread;
    direction.normalize();
    scene.updateMatrixWorld(true);
    raycaster.set(origin, direction);
    const hit = raycaster.intersectObjects(shootables, false)[0];
    if (hit) endPoint.copy(hit.point);
    else endPoint.copy(origin).addScaledVector(direction, RANGE);

    muzzlePoint.set(rec.muzzle[0] * VM_SCALE, rec.muzzle[1] * VM_SCALE, rec.muzzle[2] * VM_SCALE);
    camera.localToWorld(muzzlePoint);
    spawnTracer(muzzlePoint, endPoint);
    if (hit) {
      spawnPuff(hit.point, 5, 1.6);
      if (hit.object.userData.bot) {
        const head = hit.object.userData.part === 'head';
        applyDamage(hit.object, head ? 'head' : 'body', head ? rec.damageHead : rec.damageBody);
      }
    }
    return true;
  }

  function step(dt) {
    // Timers across every slot so a half-finished reload survives a switch back.
    for (const slot of weapon.slots) {
      if (slot.cooldown > 0) slot.cooldown = Math.max(0, slot.cooldown - dt);
      if (slot.reloadLeft > 0) {
        slot.reloadLeft = Math.max(0, slot.reloadLeft - dt);
        if (slot.reloadLeft === 0) {
          const rec = WEAPONS[weapon.slots.indexOf(slot)];
          const take = Math.min(rec.mag - slot.mag, slot.reserve);
          slot.mag += take;
          slot.reserve -= take;
        }
      }
      if (slot.recoilIndex > 0 && state.time - slot.lastShot > RECOIL_RESET) slot.recoilIndex = 0;
    }

    weapon.switchLeft = Math.max(0, weapon.switchLeft - dt);
    weapon.flash = Math.max(0, weapon.flash - dt);
    weapon.kick += (0 - weapon.kick) * Math.min(1, dt * 14);

    if (state.input.firing) tryFire(currentSpread());

    // Viewmodel: only the active weapon shows; kick, switch dip and reload dip are code-driven.
    const rec = WEAPONS[weapon.slot];
    const slot = weapon.slots[weapon.slot];
    for (let i = 0; i < models.length; i += 1) {
      const model = models[i];
      model.visible = i === weapon.slot;
      if (!model.visible) continue;
      model.position.z = basePos[i].z + weapon.kick;
      model.rotation.x = weapon.kick * 2.2;
      if (weapon.switchLeft > 0) {
        const phase = 1 - weapon.switchLeft / SWITCH_TIME;
        model.position.y = basePos[i].y - Math.sin(phase * Math.PI) * 0.22;
      } else if (slot.reloadLeft > 0) {
        const progress = 1 - slot.reloadLeft / rec.reload;
        model.position.y = basePos[i].y - Math.sin(progress * Math.PI) * 0.08;
        model.rotation.x = -0.55 * Math.sin(progress * Math.PI);
      } else {
        model.position.y = basePos[i].y;
      }
    }

    flash.visible = weapon.flash > 0;
    flash.position.set(rec.muzzle[0] * VM_SCALE, rec.muzzle[1] * VM_SCALE, rec.muzzle[2] * VM_SCALE);
    flash.rotation.z = weapon.flash * 30;
    const flashScale = 0.7 + (weapon.flash / FLASH_TIME) * 0.5;
    flash.scale.set(flashScale, flashScale, 1);
    flashLight.position.set(rec.muzzle[0] * 0.7, rec.muzzle[1] * 0.7, rec.muzzle[2] * 0.7);
    flashLight.intensity = weapon.flash > 0 ? 18 : 0;

    // Puff particles: integrate, then park the dead ones below the floor.
    const positions = puff.geometry.attributes.position.array;
    for (let i = 0; i < PUFF_COUNT; i += 1) {
      if (puff.life[i] <= 0) continue;
      puff.life[i] -= dt;
      if (puff.life[i] <= 0) {
        positions[i * 3 + 1] = -100;
        continue;
      }
      positions[i * 3] += puff.velocity[i * 3] * dt;
      positions[i * 3 + 1] += puff.velocity[i * 3 + 1] * dt;
      positions[i * 3 + 2] += puff.velocity[i * 3 + 2] * dt;
      puff.velocity[i * 3 + 1] -= 9 * dt;
    }
    puff.geometry.attributes.position.needsUpdate = true;

    for (const tracer of tracers) {
      if (tracer.life <= 0) continue;
      tracer.life -= dt;
      tracer.line.material.opacity = Math.max(0, tracer.life / TRACER_TIME) * 0.7;
      tracer.line.visible = tracer.life > 0;
    }
  }

  function refill() {
    weapon.slot = 0;
    weapon.switchLeft = 0;
    weapon.flash = 0;
    weapon.kick = 0;
    for (let i = 0; i < WEAPONS.length; i += 1) {
      const slot = weapon.slots[i];
      slot.mag = WEAPONS[i].mag;
      slot.reserve = WEAPONS[i].reserve;
      slot.cooldown = 0;
      slot.reloadLeft = 0;
      slot.recoilIndex = 0;
      slot.lastShot = -1;
    }
  }

  // Shared hitscan for bot fire: same raycaster, tracer and puff pools, same applyDamage
  // route as the player's shots. spread is radians of cone; recordIndex picks WEAPONS stats.
  function botShot(origin, direction, spread, recordIndex) {
    const rec = WEAPONS[recordIndex] ?? WEAPONS[1];
    direction.x += (random() * 2 - 1) * spread;
    direction.y += (random() * 2 - 1) * spread;
    direction.z += (random() * 2 - 1) * spread;
    direction.normalize();
    scene.updateMatrixWorld(true);
    raycaster.set(origin, direction);
    const hit = raycaster.intersectObjects(shootables, false)[0];
    if (hit) endPoint.copy(hit.point);
    else endPoint.copy(origin).addScaledVector(direction, RANGE);
    spawnTracer(origin, endPoint);
    if (hit) {
      spawnPuff(hit.point, 5, 1.6);
      if (hit.object.userData.bot) {
        const head = hit.object.userData.part === 'head';
        applyDamage(hit.object, head ? 'head' : 'body',
          head ? rec.damageHead : rec.damageBody);
      } else if (hit.object.userData.playerHit) {
        const head = hit.object.userData.part === 'head';
        damagePlayer(head ? rec.damageHead : rec.damageBody, head ? 'head' : 'body');
      }
    }
  }

  return {
    WEAPONS,
    step,
    tryFire,
    botShot,
    reload,
    switchTo,
    currentSpread,
    spawnPuff,
    refill,
    activeRecord() {
      return WEAPONS[weapon.slot];
    },
    activeSlot() {
      return weapon.slots[weapon.slot];
    },
  };
}
