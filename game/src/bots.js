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
  { name: 'siteA', x: -14, z: -13 }, { name: 'siteB', x: 25, z: -8 },
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
// Neighbour lists per node (for local detours when a straight line is walled off).
const ADJACENT = NODES.map(() => []);

function buildRoutes() {
  for (const [a, b] of EDGES) {
    ADJACENT[a].push(b);
    ADJACENT[b].push(a);
  }
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

// Patrol loops (node index cycles) per team. Attackers rotate between both
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

// TODO: module-level temp vectors and shared geometry.
const temps = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3() };

const geometry = {};

function makeBody(scene, team) {
  // Capsule torso + head sphere, both tagged parts so weapons.js's hitscan route
  // (userData.bot / userData.part) applies damage directly. Team tint on the head,
  // re-colourable because sides swap at the half.
  const group = new THREE.Group();
  const tint = team === TEAM.PLAYER ? 0x7aa35a : 0xa34a3a;
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.6 });
  const headMat = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.45 });
  const torso = new THREE.Mesh(geometry.torso, bodyMat);
  torso.position.y = 1.0;
  torso.castShadow = true;
  const head = new THREE.Mesh(geometry.head, headMat);
  head.position.y = 1.53;
  head.castShadow = true;
  // Limbs: shared box geometry pivoted at the top (shoulder/hip), so rotation.x swings them.
  const armL = new THREE.Mesh(geometry.limb, headMat);
  const armR = new THREE.Mesh(geometry.limb, headMat);
  armL.position.set(-0.36, 1.32, 0);
  armR.position.set(0.36, 1.32, 0);
  const legL = new THREE.Mesh(geometry.limb, bodyMat);
  const legR = new THREE.Mesh(geometry.limb, bodyMat);
  legL.position.set(-0.14, 0.66, 0);
  legR.position.set(0.14, 0.66, 0);
  for (const limb of [armL, armR, legL, legR]) limb.castShadow = true;
  group.add(torso, head, armL, armR, legL, legR);
  scene.add(group);
  return { group, torso, head, headMat, armL, armR, legL, legR };
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
  geometry.limb = new THREE.BoxGeometry(0.13, 0.52, 0.13);
  geometry.limb.translate(0, -0.26, 0); // pivot at the shoulder/hip end
  buildRoutes();
}

// Sides swap at the half: the first two bots stay with the player, the other three take the
// opposing side. Re-tags team, tint, name and patrol route to match.
export function applyTeams(playerTeam) {
  let friendly = 0;
  let enemy = 0;
  for (let i = 0; i < state.bots.length; i += 1) {
    const bot = state.bots[i];
    bot.team = i < 2 ? playerTeam : 1 - playerTeam;
    bot.body.headMat.color.set(bot.team === 0 ? 0x7aa35a : 0xa34a3a);
    if (bot.team === playerTeam) {
      friendly += 1;
      bot.name = `Friendly ${friendly}`;
    } else {
      enemy += 1;
      bot.name = `Enemy ${enemy}`;
    }
    bot.patrol = PATROLS[bot.team][i % PATROLS[bot.team].length];
    bot.patrolAt = 0;
  }
}

// Spawn corners per team: index 1 belongs to the player (rounds.js respawns them there),
// so bots take the remaining corners in order 0, 2, 3, … and if a side ever has more bots
// than free corners, the overflow fans out 0.9 m beside the last corner. Writes into out.
const PLAYER_SPAWN_INDEX = 1;
function teamSpawnPoint(list, ordinal, out) {
  const index = ordinal < PLAYER_SPAWN_INDEX ? ordinal : ordinal + 1;
  if (index < list.length) return out.copy(list[index].position);
  const base = list[list.length - 1].position;
  return out.set(base.x + (ordinal - list.length + 2) * 0.9, 0, base.z + 0.9);
}

// Spawn all five bots: the two friendly ones and the three opposing ones, each walking its
// team's patrol loop; world.spawn positions carry y=0. Initial teams: player side attacks
// in the first half (rounds.js re-tags via applyTeams when the sides swap).
export function spawnBots(scene) {
  state.bots.length = 0;
  const spawn = (team, index) => {
    const body = makeBody(scene, team);
    const bot = {
      name: `${team === TEAM.PLAYER ? 'Friendly' : 'Enemy'} ${index + 1}`,
      team, index, body,
      slot: state.bots.length, // position in state.bots; bomb.carrier uses this
      health: HEALTH, alive: true, fall: 0,
      position: new THREE.Vector3(), yaw: 0,
      patrol: PATROLS[team][index % PATROLS[team].length],
      patrolAt: 0, node: -1, goal: -1,
      mode: 'patrol', holdNode: -1, holdScan: 0,
      target: null, lastSeen: new THREE.Vector3(), lastSeenAt: -99, burst: 0, fireAt: 0, aimError: 0.09,
      seesEnemy: false, goalX: 0, goalZ: 0, goalRange: 0,
      walkPhase: 0, lastX: 0, lastZ: 0,
    };
    for (const mesh of [body.torso, body.head]) {
      mesh.userData.part = mesh === body.head ? 'head' : 'body';
      mesh.userData.bot = bot;
    }
    worldRef.shootables.push(body.torso, body.head); // weapons.js raycasts these
    state.bots.push(bot);
    return bot;
  };
  // Friendly #0 is replaced by the player; the remaining corners go to the bots, with the
  // player's corner (index 1) reserved.
  const spawns = worldRef.spawns;
  const placed = { 0: 0, 1: 0 };
  for (let i = 0; i < 2; i += 1) {
    const bot = spawn(TEAM.PLAYER, i);
    teamSpawnPoint(spawns.attackers, placed[TEAM.PLAYER], bot.position);
    placed[TEAM.PLAYER] += 1;
  }
  for (let i = 0; i < 3; i += 1) {
    const bot = spawn(TEAM.ENEMY, i);
    teamSpawnPoint(spawns.defenders, placed[TEAM.ENEMY], bot.position);
    placed[TEAM.ENEMY] += 1;
  }
}

// --- Bot senses and movement constants ------------------------------------------------------
const VISION_RANGE = 22; // was 40: at 40 m every bot saw every spawn across the long lanes
// and pinned in engage from tick one — escorts never screened, duels never resolved.
const VISION_HALF_COS = Math.cos(THREE.MathUtils.degToRad(35));
const GUNSHOT_HEAR_RANGE = 25;
const AIM_ERROR_START = 0.09;
const AIM_ERROR_END = 0.03; // round-3 tuning: was 0.012 — defenders hit practically always
const AIM_TIME = 3.0; // seconds of visibility to reach the tightest aim (was 1.6)
const BURST_GAP = 0.22; // seconds between burst rounds (was 0.11 — bots only; player fire is separate)
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

// Reusable candidate slots: acquireTarget runs 5x per tick, so nothing allocates here.
const candidatePoints = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const candidates = new Array(6);
candidates[0] = { point: null, isPlayer: true, pos: null };

// Nearest visible opposing target (player or bot) for this bot; null when none.
function acquireTarget(bot) {
  let best = null;
  let bestDist = Infinity;
  temps.b.set(bot.position.x, 1.5, bot.position.z); // bot eye
  let count = 0;
  // The PLAYER is a candidate only for opposing bots — without this team guard the
  // friendly escorts acquire the carrier as a target and shoot him in the back.
  if (bot.team !== state.player.team) {
    candidates[0].point = playerPoint(candidatePoints[0]);
    candidates[0].pos = state.player.position;
    count = 1;
  }
  for (const other of state.bots) {
    if (other === bot || !other.alive || other.team === bot.team) continue;
    const slot = candidates[count] ?? (candidates[count] = { point: null, isPlayer: false, pos: null, bot: null });
    slot.point = other.position;
    slot.pos = other.position;
    slot.bot = other;
    count += 1;
  }
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates[index];
    const pos = candidate.pos;
    const dx = pos.x - bot.position.x;
    const dz = pos.z - bot.position.z;
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
  defenderPush = 0; // round-3: per-tick cap on defenders chasing the carrier
  for (const bot of state.bots) {
    if (!bot.alive) continue; // death fall is handled in stepBodies below
    const seen = acquireTarget(bot);
    bot.seesEnemy = Boolean(seen);
    if (seen) {
      bot.target = seen;
      bot.mode = 'engage';
      bot.lastSeen.set(seen.pos.x, seen.pos.y, seen.pos.z);
      bot.lastSeenAt = state.time;
      // The player's team tightens its aim 2.5x faster (1.2 s vs 3.0 s) so the escort
      // screen wins its duels; defenders vs the scripted player keep the tuned 0.03 end
      // error and the full 3 s ramp.
      const aimTime = bot.team === state.round.playerTeam ? 1.2 : AIM_TIME;
      bot.aimError = Math.max(AIM_ERROR_END, bot.aimError - (AIM_ERROR_START - AIM_ERROR_END) * dt / aimTime);
    } else {
      bot.aimError = Math.min(AIM_ERROR_START, bot.aimError + dt * 0.05);
      if (bot.mode === 'engage') {
        bot.mode = state.time - bot.lastSeenAt < 6 ? 'seek' : 'patrol';
        bot.target = null;
      } else if (bot.mode === 'seek' && state.time - bot.lastSeenAt >= 6) {
        bot.mode = 'patrol';
      }
    }
    // Bomb objective: overrides patrol/hold/seek but never an enemy in sight.
    const objective = objectiveFor(bot);
    if (objective && bot.mode !== 'engage') {
      bot.mode = 'objective';
      bot.goalX = objective.x;
      bot.goalZ = objective.z;
      bot.goalRange = objective.range;
    } else if (!objective && bot.mode === 'objective') {
      bot.mode = 'patrol';
    }
    if (bot.mode === 'patrol') patrolStep(bot, dt);
    else if (bot.mode === 'hold') holdStep(bot, dt);
    else if (bot.mode === 'seek') seekStep(bot, dt);
    else if (bot.mode === 'objective') objectiveStep(bot, dt);
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

// --- Bomb objective steering ----------------------------------------------------------------
// The bot carrier walks to the nearer site; defenders converge on a planted bomb; attackers
// converge on a dropped bomb. Enemies in sight (engage mode) always override these.
// objectiveFor reuses one module-level result object — it is read (goalX/goalZ/goalRange
// copied out) immediately by the caller, never stored, so sharing it is safe.
const objectiveResult = { x: 0, z: 0, range: 0 };
// Round-3 tuning: at most 2 defenders push the carrier at once (the third holds), so the
// attacking side always has a window. Reset every tick in updateBots.
let defenderPush = 0;

function objectiveFor(bot) {
  const bomb = state.round.bomb;
  if (bomb.state === 'planted' && bot.team === 1) {
    objectiveResult.x = bomb.x; objectiveResult.z = bomb.z; objectiveResult.range = 2.5;
    return objectiveResult;
  }
  if (bot.team === 1 && state.round.phase === 'live'
    && (bomb.state === 'carried' || bomb.state === 'dropped')) {
    // Hunt the carrier / camp the dropped bomb BEFORE it goes down, not only after —
    // but only the first defender each tick (round-6 tuning: was 2, one chaser keeps the
    // escort fight winnable); the rest stay on patrol/hold.
    if (defenderPush >= 1) return null;
    const pos = bomb.state === 'dropped' ? bomb
      : bomb.carrier === 'player' ? state.player.position
      : (typeof bomb.carrier === 'number' ? state.bots[bomb.carrier]?.position : null);
    if (pos) {
      defenderPush += 1;
      objectiveResult.x = pos.x; objectiveResult.z = pos.z; objectiveResult.range = 2.5;
      return objectiveResult;
    }
  }
  // Escort objective: the player's team flanks AHEAD of their carrier while it walks the
  // route — 6 m toward the carrier's nearest site, offset ±2.5 m to either side by slot,
  // so the carrier is covered from two angles instead of trailing behind it.
  if (bomb.state === 'carried' && bot.team === state.round.playerTeam && bot.team === 0
    && bomb.carrier !== bot.slot && state.round.phase === 'live') {
    const pos = bomb.carrier === 'player' ? state.player.position : state.bots[bomb.carrier]?.position;
    if (pos) {
      const a = worldRef.sites.A.center;
      const b = worldRef.sites.B.center;
      const site = Math.hypot(a.x - pos.x, a.z - pos.z) <= Math.hypot(b.x - pos.x, b.z - pos.z) ? a : b;
      const dx = site.x - pos.x;
      const dz = site.z - pos.z;
      const len = Math.hypot(dx, dz) || 1;
      const side = bot.slot === 0 ? -1 : 1;
      objectiveResult.x = pos.x + (dx / len) * 6 - (dz / len) * 2.5 * side;
      objectiveResult.z = pos.z + (dz / len) * 6 + (dx / len) * 2.5 * side;
      objectiveResult.range = 1.5;
      return objectiveResult;
    }
  }
  // Post-plant: the attacker side of the player's team holds near the bomb (watching the
  // approaches) instead of wandering back to patrol while defenders run the defuse.
  if (bomb.state === 'planted' && bot.team === 0 && bot.team === state.round.playerTeam) {
    objectiveResult.x = bomb.x; objectiveResult.z = bomb.z; objectiveResult.range = 6;
    return objectiveResult;
  }
  if (bomb.state === 'dropped' && bot.team === 0) {
    objectiveResult.x = bomb.x; objectiveResult.z = bomb.z; objectiveResult.range = 1.0;
    return objectiveResult;
  }
  if (bomb.state === 'carried' && bomb.carrier === bot.slot) {
    const a = worldRef.sites.A.center;
    const b = worldRef.sites.B.center;
    const da = Math.hypot(a.x - bot.position.x, a.z - bot.position.z);
    const db = Math.hypot(b.x - bot.position.x, b.z - bot.position.z);
    const site = da <= db ? a : b;
    objectiveResult.x = site.x; objectiveResult.z = site.z; objectiveResult.range = 2.0;
    return objectiveResult;
  }
  return null;
}

// Walk the goal: direct when the line is clear, otherwise hop through the route graph
// (nearest node → next hop toward the node nearest the goal).
function objectiveStep(bot, dt) {
  const dx = bot.goalX - bot.position.x, dz = bot.goalZ - bot.position.z;
  const dist = Math.hypot(dx, dz);
  faceToward(bot, bot.goalX, bot.goalZ, dt);
  if (dist <= bot.goalRange) return; // in position; rounds.js runs the hold timer
  temps.b.set(bot.position.x, 1.5, bot.position.z);
  temps.c.set(bot.goalX, 0.5, bot.goalZ);
  if (!occluded(temps.b, temps.c)) {
    botMove(bot, (dx / dist) * SPEED * dt, (dz / dist) * SPEED * dt);
    return;
  }
  const hop = NEXT_HOP[nearestNode(bot.position.x, bot.position.z)][nearestNode(bot.goalX, bot.goalZ)];
  if (hop === -1) {
    botMove(bot, (dx / dist) * SPEED * dt, (dz / dist) * SPEED * dt);
    return;
  }
  const hx = NODES[hop].x - bot.position.x, hz = NODES[hop].z - bot.position.z;
  const hd = Math.hypot(hx, hz) || 1;
  botMove(bot, (hx / hd) * SPEED * dt, (hz / hd) * SPEED * dt);
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
// Living bots get a walk cycle: limb swing scaled by ground speed plus a small body bob, and
// an ENGAGE aim pose overrides the arm swing (both arms raised toward the target).
function stepBodies(dt) {
  for (const bot of state.bots) {
    const body = bot.body;
    if (bot.alive) {
      const moved = Math.hypot(bot.position.x - bot.lastX, bot.position.z - bot.lastZ);
      bot.lastX = bot.position.x;
      bot.lastZ = bot.position.z;
      const speed = Math.min(1, moved / Math.max(dt, 1e-4) / SPEED);
      bot.walkPhase += moved * 2.2;
      const swing = Math.sin(bot.walkPhase) * 0.55 * speed;
      const raise = bot.mode === 'engage' ? 1 : 0;
      body.legL.rotation.x = swing;
      body.legR.rotation.x = -swing;
      body.armL.rotation.x = -swing * (1 - raise) + 1.25 * raise;
      body.armR.rotation.x = swing * (1 - raise) + 1.25 * raise;
      body.group.position.set(
        bot.position.x,
        bot.position.y + Math.abs(Math.sin(bot.walkPhase)) * 0.045 * speed,
        bot.position.z,
      );
      body.group.rotation.y = bot.yaw;
      body.group.rotation.x = 0;
      continue;
    }
    body.group.position.set(bot.position.x, bot.position.y, bot.position.z);
    body.group.rotation.y = bot.yaw;
    bot.fall = Math.min(1, bot.fall + dt / FALL_SECONDS);
    body.group.rotation.x = -bot.fall * 1.45;
    body.group.position.y = -bot.fall * 0.08;
  }
}

// Apply damage to one body part. Head is lethal-fast; byPlayer routes hits/kills into
// state.stats. Returns true when this hit kills.
export function damageBot(bot, dmg, part, byPlayer) {
  if (!bot || !bot.alive) return false;
  // Damage is inert outside the fighting phases: FREEZE, ROUND_END and MATCH_END never
  // move health (rounds.js owns the phase clock).
  const phase = state.round.phase;
  if (phase !== 'live' && phase !== 'planted') return false;
  const amount = dmg; // weapons.js already sends the per-part value (damageHead vs damageBody)
  bot.health -= amount;
  // Any damage interrupts an in-progress plant/defuse (rounds.js rebuilds progress).
  state.round.bomb.progress = 0;
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

// Full reset: health, mode, route position, spawn spots. Positions follow the CURRENT team
// tags (sides swap at the half), team 0 takes attacker spawns, team 1 defender spawns.
export function respawnBots() {
  const spawns = worldRef ? worldRef.spawns : null;
  const taken = { 0: 0, 1: 0 };
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
    bot.seesEnemy = false;
    bot.goalRange = 0;
    if (!spawns) continue;
    const list = bot.team === TEAM.PLAYER ? spawns.attackers : spawns.defenders;
    teamSpawnPoint(list, taken[bot.team], bot.position); // corner 1 stays the player's
    taken[bot.team] += 1;
  }
}

// Centre of the hittable torso, for grenade blast tests; writes into the caller's vector.
export function botCenter(bot, out) {
  return out.set(bot.position.x, bot.position.y + 1.0, bot.position.z);
}

// Line-of-sight test at eye height for callers outside the bot loop (shotplayer routing):
// true when the straight segment (x1,z1)→(x2,z2) clears every collider. Own temps so it
// never clashes with the per-tick bot vectors.
const clearA = new THREE.Vector3();
const clearB = new THREE.Vector3();
export function lineClear(x1, z1, x2, z2) {
  clearA.set(x1, 1.5, z1);
  clearB.set(x2, 1.5, z2);
  return !occluded(clearA, clearB);
}

// Route-graph read access for the scripted shot player (same graph, same hop table).
export { NODES, NEXT_HOP, ADJACENT, nearestNode };
