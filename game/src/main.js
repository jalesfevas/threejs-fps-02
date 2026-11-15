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
import { initShotPlayer, updateShotPlayer } from './shotplayer.js';
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
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
    // Free the cursor so the "Play again" button is clickable; the button's handler
    // (hud.onPlay) restarts and re-locks.
    document.exitPointerLock();
  },
};
initRounds(roundDeps);
// The shot pipeline's scripted player driver: never active in a real session.
if (shot) initShotPlayer(world);

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
  if (shot) updateShotPlayer(dt); // scripted driver feeds the input snapshot pre-step
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
    hud.setHealth(state.player.health, state.player.kevlar);
    hud.setSpectate(!body.alive && state.round.phase !== 'match_end');
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(SIM_DT);
}

// Shot captures are frozen frames, so the frame loop never fills the round HUD. Instead of
// hand-pushed constants, the capture stages run the REAL simulation forward first — bots
// live, a player stand-in aiming and firing through the seeded RNG, the real round flow in
// updateRounds — and the HUD then reads whatever actually happened (round, score, timer,
// money, health). Nothing here invents a number.
function syncShotHud() {
  hud.setRound(state.round.number, state.round.score);
  hud.setRoundTimer(state.round.timer);
  hud.setMoney(state.economy.money);
  hud.setHealth(state.player.health, state.player.kevlar);
  hud.setSpectate(!body.alive && state.round.phase !== 'match_end');
  if (state.round.phase === 'match_end') hud.showMatchEnd(state.round.score);
}

// Player stand-in: every call, aim at the nearest living enemy and squeeze the trigger with
// a small cone (weapons consume the seeded random, so a seed reproduces the whole run).
function playerFire() {
  if (!body.alive) return;
  const phase = state.round.phase;
  if (phase !== 'live' && phase !== 'planted') return;
  let target = null;
  let bestDist = Infinity;
  for (const bot of state.bots) {
    if (bot.team !== 1 || !bot.alive) continue;
    const d = Math.hypot(bot.position.x - body.position.x, bot.position.z - body.position.z);
    if (d < bestDist) { bestDist = d; target = bot; }
  }
  if (!target) return;
  aimAt({ x: target.position.x, y: target.position.y + 1.35, z: target.position.z });
  weapons.tryFire(0.004);
}

// Drive the real fixed-step simulation. fastForwardAfter (the 'end' stage) compresses the
// non-fighting phases and, past that point, lets stalled rounds resolve through the real
// time-out path inside updateRounds — MATCH_END arrives via the normal round flow, never
// by forcing state. caps keep a capture well under a minute of wall clock.
function simulate(capSeconds, fastForwardAfter) {
  const maxSteps = Math.round(capSeconds / SIM_DT);
  const ffStep = fastForwardAfter == null ? Infinity : Math.round(fastForwardAfter / SIM_DT);
  for (let s = 0; s < maxSteps && state.round.phase !== 'match_end'; s += 1) {
    if (s >= ffStep) {
      state.round.timer = Math.min(state.round.timer,
        state.round.phase === 'live' || state.round.phase === 'planted' ? 1 : 0.2);
    }
    if (s % 45 === 0) playerFire(); // ≈ every 0.75 s of sim time
    step(SIM_DT);
  }
  if (fastForwardAfter == null) return;
  for (let s = 0; s < 2400 && state.round.phase !== 'match_end'; s += 1) {
    state.round.timer = Math.min(state.round.timer, 0.1);
    step(SIM_DT);
  }
}

function runShot(name) {
  hud.hideOverlay();
  body.pitch = 0;
  body.yaw = 0;
  if (name === 'play') {
    // ~90 s of the real match: the HUD shows a genuine mid-match state.
    simulate(90, null);
    playerFire(); // one aimed look for the capture frame
  } else if (name === 'end') {
    // Fight for a while, then fast-forward the rest through the real flow so the overlay
    // carries the true final score of a completed match.
    simulate(240, 150);
  } else {
    // start: the genuine round-1 freeze, a third of a second in.
    settle(20);
    aimAt(new THREE.Vector3(0, 1.5, -6));
    hud.showOverlay('start', 0);
  }
  hud.setScore(state.score);
  hud.setAmmo(weapons.activeSlot().mag, weapons.activeSlot().reserve);
  hud.setGrenades(state.grenades.count);
  syncShotHud();
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
