// Boot and the one loop: a fixed 60 Hz simulation (accumulator, clamped so a slow frame
// never spirals) feeding one render per animation frame. Weapons, grenades and targets all
// step inside the fixed step; the render frame only turns accumulated look deltas, pushes
// HUD values (cached, so unchanged DOM is never rewritten) and draws. The loop allocates
// nothing — vectors and the look delta are reused. All mutable game state lives in state.js.
// ?shot=start|play|end with &seed=N sets up a deterministic frame for a capture, renders it
// twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { state } from './state.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer, respawnPlayer, damagePlayer } from './player.js';
import { createWeapons } from './weapons.js';
import { createGrenades } from './grenade.js';
import { initBots, spawnBots, updateBots, damageBot, botCenter, respawnBots } from './bots.js';
import { initRounds, updateRounds } from './rounds.js';
import { initBombs, updateBombs } from './bombs.js';
import { initEconomy, createBuyMenu, canOpen, award } from './economy.js';
import { createHud } from './hud.js';

const SIM_DT = 1 / 60;
const MAX_STEPS = 5;
const BLAST_RADIUS = 6;
const BLAST_DAMAGE = 110;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = false;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
// Bots must exist before weapons.js snapshots the shootable list (bots push their
// torso/head meshes into world.shootables at spawn time).
initBots(scene, world, (origin, dir, spread, recordIndex) => weapons.botShot(origin, dir, spread, recordIndex));
initBombs(scene);
spawnBots(scene);
const hud = createHud();
const player = createPlayer(world.colliders, world.shootables);
scene.add(player.hitRoot);
const weapons = createWeapons(camera, scene, {
  shootables: world.shootables,
  random,
  recoil: (pitchKick, yawKick) => player.recoil(pitchKick, yawKick),
  applyDamage,
});
const grenades = createGrenades(scene, world.colliders, { onExplode });
const input = createInput(renderer.domElement, onLockChange);

initEconomy();
const buyMenu = createBuyMenu(weapons);
const roundDeps = {
  world,
  player,
  respawnBots,
  respawnPlayer,
  hud,
  onRoundEnd(winner) {
    award(winner === 0 ? 'win' : 'loss');
  },
  onPlant() {
    award('plant');
  },
  onMatchEnd() {
    cleared = true;
  },
};
initRounds(roundDeps);

const body = player.state;
const halfFovTan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
const blastCenter = new THREE.Vector3();

const markerHoldMs = shot ? 4000 : 90;
let cleared = false;
let started = false;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();

// One funnel for every damage source (bullets, blasts): score, hit marker, kill feed.
function applyDamage(object, part, amount) {
  const bot = object.userData.bot;
  if (!bot) return false;
  const killed = damageBot(bot, amount, part, bot.team === 1); // team 1 = enemies of the player
  if (bot.team === 1) {
    state.score += killed ? 100 : 10;
    hud.setScore(state.score);
    hud.hitMarker(killed, part === 'head', markerHoldMs);
  }
  if (killed) {
    hud.addKill(bot.name);
    if (bot.team === 1) award('kill');
  }
  return killed;
}

function onExplode(position) {
  weapons.spawnPuff(position, 24, 4.5);
  state.fx.shake = Math.min(1, state.fx.shake + 0.55);
  for (const bot of state.bots) {
    if (!bot.alive) continue;
    botCenter(bot, blastCenter);
    const distance = blastCenter.distanceTo(position);
    if (distance >= BLAST_RADIUS) continue;
    applyDamage(bot.body.torso, 'body', BLAST_DAMAGE * (1 - distance / BLAST_RADIUS));
  }
  // The player's own blast hurts the player as well.
  const playerDistance = body.position.distanceTo(position);
  if (playerDistance < BLAST_RADIUS) {
    damagePlayer(BLAST_DAMAGE * (1 - playerDistance / BLAST_RADIUS), 'body');
  }
}

weapons.refill();
hud.setWeapon(weapons.activeRecord().name);
hud.setAmmo(weapons.activeSlot().mag, weapons.activeSlot().reserve);
hud.setGrenades(state.grenades.count);
hud.setScore(0);
hud.onPlay(() => {
  if (shot) return;
  if (cleared) restart();
  input.requestLock();
});

function restart() {
  cleared = false;
  state.score = 0;
  state.stats.hits = 0;
  state.stats.kills = 0;
  state.stats.headshots = 0;
  initEconomy();
  state.round.score = [0, 0];
  initRounds(roundDeps);
  weapons.refill();
  grenades.reset();
  hud.setScore(0);
  hud.setAmmo(weapons.activeSlot().mag, weapons.activeSlot().reserve);
  hud.setGrenades(state.grenades.count);
  hud.setSpectate(false);
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (!cleared) {
    hud.showOverlay(started ? 'paused' : 'start', state.score);
  }
}

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  // Screen shake, deterministic in the sim clock so captures stay reproducible.
  const shake = state.fx.shake;
  if (shake > 0) {
    camera.position.x += Math.sin(state.time * 47) * shake * 0.05;
    camera.position.y += Math.cos(state.time * 53) * shake * 0.04;
  }
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function step(dt) {
  state.time += dt;
  updateRounds(dt);
  player.step(dt);
  weapons.step(dt);
  grenades.step(dt);
  updateBots(dt);
  updateBombs();
  state.fx.shake = Math.max(0, state.fx.shake - dt * 1.8);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    const pressed = state.input.pressed;
    if (buyMenu.open) {
      if (pressed.has('KeyB') || pressed.has('Escape')) buyMenu.close();
      else for (const code of ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5']) {
        if (pressed.has(code)) buyMenu.handleKey(code);
      }
      pressed.clear(); // the menu owns the keyboard while open
    } else {
      if (pressed.has('KeyB') && canOpen()) buyMenu.toggle();
      if (pressed.has('KeyR')) weapons.reload();
      if (pressed.has('Digit1')) weapons.switchTo(0);
      if (pressed.has('Digit2')) weapons.switchTo(1);
      if (pressed.has('Digit3')) weapons.switchTo(2);
      if (pressed.has('KeyG') || pressed.has('MouseMiddle')) grenades.throw();
      pressed.clear();
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= SIM_DT && steps < MAX_STEPS) {
      step(SIM_DT);
      accumulator -= SIM_DT;
      steps += 1;
    }
    if (accumulator > SIM_DT * MAX_STEPS) accumulator = 0;
    syncCamera();
    const record = weapons.activeRecord();
    const slot = weapons.activeSlot();
    hud.setWeapon(record.name);
    hud.setAmmo(slot.mag, slot.reserve);
    hud.setReload(slot.reloadLeft > 0 ? 1 - slot.reloadLeft / record.reload : -1);
    hud.setGrenades(state.grenades.count);
    hud.setCrosshair(Math.max(3, weapons.currentSpread() / halfFovTan * window.innerHeight / 2));
    hud.setRoundTimer(state.round.timer);
    hud.setMoney(state.economy.money);
    hud.setSpectate(!body.alive && state.round.phase !== 'match_end');
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(SIM_DT);
}

function runShot(name) {
  hud.hideOverlay();
  body.pitch = 0;
  body.yaw = 0;
  if (name === 'play' || name === 'end') {
    body.position.set(0, 0, -5);
    settle(20);
    const aimPoints = state.bots.map((bot) => new THREE.Vector3(bot.position.x, bot.position.y + 1.53, bot.position.z));
    const count = name === 'play' ? 1 : aimPoints.length;
    for (let index = 0; index < count; index += 1) {
      const point = aimPoints[index % aimPoints.length];
      for (let round = 0; round < 3; round += 1) {
        aimAt(point);
        weapons.tryFire(0);
        if (round < 2) settle(8);
      }
    }
    if (name === 'play') {
      settle(12);
      aimAt(aimPoints[1 % aimPoints.length]);
      weapons.tryFire(0);
      settle(1);
    } else {
      settle(40);
    }
  } else {
    body.position.set(0.6, 0, 8.6);
    settle(20);
    aimAt(new THREE.Vector3(0, 1.5, -6));
    hud.showOverlay('start', 0);
  }
  hud.setScore(state.score);
  hud.setAmmo(weapons.activeSlot().mag, weapons.activeSlot().reserve);
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
