// Team bots: player + 2 friendlies vs 3 enemies. Capsule body + head sphere, tagged parts
// so weapons.js's hitscan route (userData.target / userData.part) applies damage directly.
import * as THREE from 'three';
import { state } from './state.js';

const TEAM = { PLAYER: 0, ENEMY: 1 };
const HEALTH = 100;
const FALL_SECONDS = 0.4;
const SPEED = 3.2;

// Route graph over Kiln Yard. Nodes: spawn corners, lane mouths (gaps in the dividers at
// x=±10, z≈-5..4), courtyard, and both sites. Edges are hand-picked straight segments that
// clear every collider in world.js.
const NODES = [
  { name: 'atkSW', x: -16, z: 17.5 }, { name: 'atkMid', x: 0, z: 18 }, { name: 'atkSE', x: 16, z: 17.5 },
  { name: 'defNW', x: -13, z: -17.5 }, { name: 'defMid', x: 0, z: -17.5 }, { name: 'defNE', x: 13, z: -17.5 },
  { name: 'westMouth', x: -10, z: -0.5 }, { name: 'eastMouth', x: 10, z: -0.5 },
  { name: 'courtyardS', x: 0, z: 8 }, { name: 'courtyardN', x: 0, z: -8 },
  { name: 'siteA', x: -21, z: -13 }, { name: 'siteB', x: 25, z: -8 },
  { name: 'kilnLane', x: -18, z: 4 }, { name: 'dockLane', x: 18, z: 6 },
  { name: 'dockApproach', x: 20, z: -14 },
];
const EDGES = [
  [0, 2], [1, 2], [0, 1], // attacker line
  [0, 12], [12, 6], [12, 8], // west lane via kiln lane
  [1, 8], [2, 13], [13, 7], [13, 8], // mid/east route
  [6, 9], [8, 9], [7, 9], // into courtyard north
  [6, 10], [9, 10], // to site A
  [9, 3], [9, 4], [9, 14], [14, 5], [14, 11], [7, 11], [7, 5], // north side + site B
];
// BFS once at init: for every pair, the next hop from A toward B.
const NEXT_HOP = NODES.map(() => new Array(NODES.length).fill(-1));

function buildRoutes() {
  for (let start = 0; start < NODES.length; start += 1) {
    const prev = new Array(NODES.length).fill(-1);
    prev[start] = start;
    const queue = [start];
    while (queue.length) {
      const node = queue.shift();
      for (const [a, b] of EDGES) {
        for (const next of a === node ? [b] : b === node ? [a] : []) {
          if (prev[next] === -1) { prev[next] = node; queue.push(next); }
        }
      }
    }
    for (let goal = 0; goal < NODES.length; goal += 1) {
      if (goal === start || prev[goal] === -1) continue;
      let hop = goal;
      while (prev[hop] !== start) hop = prev[hop];
      NEXT_HOP[start][goal] = hop;
    }
  }
}

function nearestNode(x, z) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < NODES.length; i += 1) {
    const dx = NODES[i].x - x, dz = NODES[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

// Patrol loops (node index cycles) and hold nodes per team. Attackers rotate between both
// sites through the courtyard; defenders split west/mid/east and hold their site.
const PATROLS = {
  0: [
    [0, 12, 6, 8, 9, 10, 9, 8, 12, 0],
    [2, 13, 7, 9, 14, 11, 14, 9, 7, 13, 2],
  ],
  1: [
    [3, 9, 10, 9, 3],
    [4, 9, 14, 11, 14, 9, 4],
    [5, 14, 11, 14, 5],
  ],
};
const HOLDS = {
  0: [10, 11, 9],
  1: [10, 11, 14],
};

// TODO: module-level temp vectors, materials, shared geometry.
const temps = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3() };

const materials = {};
const geometry = {};

function makeBody(scene, team) {
  // Capsule torso + head sphere, both tagged parts so weapons.js's hitscan route
  // (userData.target / userData.part) applies damage directly. Team tint on the head.
  const group = new THREE.Group();
  const tint = team === TEAM.PLAYER ? 0x7aa35a : 0xa34a3a;
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.6 });
  const headMat = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.45 });
  const torso = new THREE.Mesh(geometry.torso, bodyMat);
  torso.position.y = 1.0;
  const head = new THREE.Mesh(geometry.head, headMat);
  head.position.y = 1.53;
  group.add(torso, head);
  scene.add(group);
  return { group, torso, head };
}

let sceneRef = null;
let worldRef = null;
let fireShot = null; // (origin, dir, spread, recordIndex) -> shared hitscan in weapons.js
// Build shared geometry and the route table once.
export function initBots(scene, world, fire) {
  sceneRef = scene;
  worldRef = world;
  fireShot = fire;
  geometry.torso = new THREE.CapsuleGeometry(0.26, 0.62, 4, 8);
  geometry.head = new THREE.SphereGeometry(0.155, 16, 12);
  buildRoutes();
}

// 2 friendlies from attacker spawns, 3 enemies from defender spawns. Each bot walks its
// team's patrol loop; world.spawn positions carry y=0.
export function spawnBots(scene) {
  state.bots.length = 0;
  const spawn = (team, index) => {
    const body = makeBody(scene, team);
    const bot = {
      name: `${team === TEAM.PLAYER ? 'Friendly' : 'Enemy'} ${index + 1}`,
      team, index, body,
      health: HEALTH, alive: true, fall: 0,
      position: new THREE.Vector3(), yaw: 0,
      patrol: PATROLS[team][index % PATROLS[team].length],
      patrolAt: 0, node: -1, goal: -1,
      mode: 'patrol', holdNode: -1, holdScan: 0,
      target: null, lastSeen: new THREE.Vector3(), lastSeenAt: -99, burst: 0, fireAt: 0, aimError: 0.09,
    };
    for (const mesh of [body.torso, body.head]) {
      mesh.userData.part = mesh === body.head ? 'head' : 'body';
      mesh.userData.bot = bot;
    }
    worldRef.shootables.push(body.torso, body.head); // weapons.js raycasts these
    state.bots.push(bot);
    return bot;
  };
  // Friendly #0 is replaced by the player; two friendlies take attacker spawns 1 and 2.
  const spawns = worldRef.spawns;
  for (let i = 0; i < 2; i += 1) {
    const bot = spawn(TEAM.PLAYER, i);
    bot.position.copy(spawns.attackers[i + 1].position);
  }
  for (let i = 0; i < 3; i += 1) {
    const bot = spawn(TEAM.ENEMY, i);
    bot.position.copy(spawns.defenders[i].position);
  }
}

// --- Bot senses and movement constants ------------------------------------------------------
const VISION_RANGE = 40;
const VISION_HALF_COS = Math.cos(THREE.MathUtils.degToRad(35));
const GUNSHOT_HEAR_RANGE = 25;
const AIM_ERROR_START = 0.09;
const AIM_ERROR_END = 0.012;
const AIM_TIME = 1.6; // seconds of visibility to reach the tightest aim
const BURST_GAP = 0.11; // seconds between burst rounds
const BURST_REST = 0.55;

const ray = new THREE.Ray();
const rayHit = new THREE.Vector3();

// Line of sight from a bot's eye to a point: blocked by any world collider box.
function occluded(from, to) {
  temps.a.copy(to).sub(from);
  const distance = temps.a.length();
  if (distance < 0.001) return false;
  temps.a.divideScalar(distance);
  ray.set(from, temps.a);
  for (const collider of worldRef.colliders) {
    if (ray.intersectBox(collider, rayHit) && from.distanceTo(rayHit) < distance - 0.05) return true;
  }
  return false;
}

// Player position (eye-level) as an enemy-visible point.
function playerPoint(out) {
  return out.set(state.player.position.x, state.player.position.y + 1.5, state.player.position.z);
}

// Nearest visible opposing target (player or bot) for this bot; null when none.
function acquireTarget(bot) {
  let best = null;
  let bestDist = Infinity;
  temps.b.set(bot.position.x, 1.5, bot.position.z); // bot eye
  const candidates = [];
  playerPoint(temps.a);
  candidates.push({ point: temps.a, isPlayer: true, pos: state.player.position });
  for (const other of state.bots) {
    if (other === bot || !other.alive || other.team === bot.team) continue;
    candidates.push({ point: other.position, isPlayer: false, pos: other.position, bot: other });
  }
  for (const candidate of candidates) {
    const dx = candidate.pos.x - bot.position.x;
    const dz = candidate.pos.z - bot.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > VISION_RANGE) continue;
    // Cone check against the bot's facing yaw (70 degrees full angle).
    const fx = -Math.sin(bot.yaw), fz = -Math.cos(bot.yaw);
    if ((dx * fx + dz * fz) / (dist || 1) < VISION_HALF_COS) continue;
    temps.c.copy(candidate.point);
    if (occluded(temps.b, temps.c)) continue;
    if (dist < bestDist) { bestDist = dist; best = candidate; }
  }
  return best;
}

const probe = new THREE.Box3();
const BOT_RADIUS = 0.35;

// Horizontal axis move with the same collider probe the player uses (no step-up needed:
// route edges avoid ledges except the dock pad, which is only 0.8 m — treated as a wall).
function botMove(bot, dx, dz) {
  for (const [axis, delta] of [[0, dx], [2, dz]]) {
    if (!delta) continue;
    const nx = axis === 0 ? bot.position.x + delta : bot.position.x;
    const nz = axis === 2 ? bot.position.z + delta : bot.position.z;
    probe.min.set(nx - BOT_RADIUS, 0.05, nz - BOT_RADIUS);
    probe.max.set(nx + BOT_RADIUS, 1.7, nz + BOT_RADIUS);
    let blocked = false;
    for (const collider of worldRef.colliders) {
      if (probe.intersectsBox(collider) && collider.max.y > 0.5) { blocked = true; break; }
    }
    if (!blocked) {
      if (axis === 0) bot.position.x = nx; else bot.position.z = nz;
    }
  }
}

// Face toward a point smoothly (used for HOLD scans too); returns nothing.
function faceToward(bot, x, z, dt, turnRate = 6) {
  const want = Math.atan2(-(x - bot.position.x), -(z - bot.position.z));
  let delta = want - bot.yaw;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  bot.yaw += delta * Math.min(1, dt * turnRate);
}

export function updateBots(dt) {
  for (const bot of state.bots) {
    if (!bot.alive) continue; // death fall is handled in stepBodies below
    const seen = acquireTarget(bot);
    if (seen) {
      bot.target = seen;
      bot.mode = 'engage';
      bot.lastSeen.set(seen.pos.x, seen.pos.y, seen.pos.z);
      bot.lastSeenAt = state.time;
      bot.aimError = Math.max(AIM_ERROR_END, bot.aimError - (AIM_ERROR_START - AIM_ERROR_END) * dt / AIM_TIME);
    } else {
      bot.aimError = Math.min(AIM_ERROR_START, bot.aimError + dt * 0.05);
      if (bot.mode === 'engage') {
        bot.mode = state.time - bot.lastSeenAt < 6 ? 'seek' : 'patrol';
        bot.target = null;
      } else if (bot.mode === 'seek' && state.time - bot.lastSeenAt >= 6) {
        bot.mode = 'patrol';
      }
    }
    if (bot.mode === 'patrol') patrolStep(bot, dt);
    else if (bot.mode === 'hold') holdStep(bot, dt);
    else if (bot.mode === 'seek') seekStep(bot, dt);
    else engageStep(bot, seen, dt);
  }
  stepBodies(dt);
}

// Stand at a hold node, slowly scanning yaw left and right.
function holdStep(bot, dt) {
  bot.holdScan -= dt;
  bot.yaw += Math.sin(state.time * 0.8 + bot.index) * dt * 0.9;
  if (bot.holdScan <= 0) bot.mode = 'patrol';
}

// Move toward the last known enemy position; gunshots heard (any bot fire within 25 m)
// already refresh lastSeen via hearGunshot(), called by the fire path in weapons wiring.
function seekStep(bot, dt) {
  const dx = bot.lastSeen.x - bot.position.x, dz = bot.lastSeen.z - bot.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1.5) { bot.mode = 'patrol'; return; }
  faceToward(bot, bot.lastSeen.x, bot.lastSeen.z, dt);
  botMove(bot, (dx / dist) * SPEED * dt, (dz / dist) * SPEED * dt);
}

// Face the target, tighten aim while visible, and fire bursts through the shared hitscan.
function engageStep(bot, seen, dt) {
  const point = seen ? seen.point : bot.lastSeen;
  faceToward(bot, point.x, point.z, dt, 9);
  if (!seen) return; // no visible target: just track lastSeen until the mode drops to seek
  temps.b.set(bot.position.x, 1.45, bot.position.z);
  // Aim at the chest, with an error that shrinks the longer the target stays visible.
  temps.c.copy(point);
  temps.c.x += (Math.sin(state.time * 13 + bot.index * 5) * bot.aimError);
  temps.c.y += (Math.cos(state.time * 11 + bot.index * 3) * bot.aimError);
  temps.c.sub(temps.b).normalize();
  if (state.time >= bot.fireAt) {
    fireShot(temps.b, temps.c, bot.aimError, 1); // Ember: the SMG record fits bot bursts
    hearGunshot(bot.position.x, bot.position.z);
    bot.burst += 1;
    bot.fireAt = state.time + (bot.burst % 5 === 0 ? BURST_REST : BURST_GAP);
  }
}

// A gunshot at (x, z): every opposing living bot within 25 m learns the position.
export function hearGunshot(x, z) {
  for (const bot of state.bots) {
    if (!bot.alive || bot.mode === 'engage') continue;
    if (Math.hypot(bot.position.x - x, bot.position.z - z) > GUNSHOT_HEAR_RANGE) continue;
    bot.lastSeen.set(x, 0, z);
    bot.lastSeenAt = state.time;
    if (bot.mode === 'patrol' || bot.mode === 'hold') bot.mode = 'seek';
  }
}

function patrolStep(bot, dt) {
  const goal = bot.patrol[bot.patrolAt];
  const tx = NODES[goal].x, tz = NODES[goal].z;
  const dx = tx - bot.position.x, dz = tz - bot.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1.2) {
    bot.patrolAt = (bot.patrolAt + 1) % bot.patrol.length;
    // Every few laps, hold at the current node's hold point for a while.
    if (bot.patrolAt === 0) { bot.mode = 'hold'; bot.holdScan = 3 + bot.index * 1.3; }
    return;
  }
  faceToward(bot, tx, tz, dt);
  botMove(bot, (dx / dist) * SPEED * dt, (dz / dist) * SPEED * dt);
}

// Sync meshes to bot state; dead bots fall over then stay down (rounds module respawns them).
function stepBodies(dt) {
  for (const bot of state.bots) {
    const body = bot.body;
    body.group.position.set(bot.position.x, bot.position.y, bot.position.z);
    body.group.rotation.y = bot.yaw;
    if (bot.alive) {
      body.group.rotation.x = 0;
      continue;
    }
    bot.fall = Math.min(1, bot.fall + dt / FALL_SECONDS);
    body.group.rotation.x = -bot.fall * 1.45;
    body.group.position.y = -bot.fall * 0.08;
  }
}

// Apply damage to one body part. Head is lethal-fast; byPlayer routes hits/kills into
// state.stats. Returns true when this hit kills.
export function damageBot(bot, dmg, part, byPlayer) {
  if (!bot || !bot.alive) return false;
  const amount = dmg; // weapons.js already sends the per-part value (damageHead vs damageBody)
  bot.health -= amount;
  if (byPlayer) {
    state.stats.hits += 1;
    if (part === 'head') state.stats.headshots += 1;
  }
  if (bot.health > 0) return false;
  bot.alive = false;
  bot.fall = 0;
  bot.mode = 'patrol';
  if (byPlayer) state.stats.kills += 1;
  return true;
}

// Full reset for the future rounds module: health, mode, route position, spawn spots.
export function respawnBots() {
  const spawns = worldRef ? worldRef.spawns : null;
  for (const bot of state.bots) {
    bot.alive = true;
    bot.health = HEALTH;
    bot.fall = 0;
    bot.mode = 'patrol';
    bot.patrolAt = 0;
    bot.target = null;
    bot.aimError = AIM_ERROR_START;
    bot.lastSeenAt = -99;
    bot.fireAt = 0;
    bot.burst = 0;
    if (!spawns) continue;
    const list = bot.team === TEAM.PLAYER ? spawns.attackers : spawns.defenders;
    bot.position.copy(list[(bot.index + (bot.team === TEAM.PLAYER ? 1 : 0)) % list.length].position);
  }
}

// Centre of the hittable torso, for grenade blast tests; writes into the caller's vector.
export function botCenter(bot, out) {
  return out.set(bot.position.x, bot.position.y + 1.0, bot.position.z);
}
