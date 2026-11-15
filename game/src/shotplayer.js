// Scripted player driver for ?shot= captures ONLY. Feeds the same input snapshot the real
// player reads (state.input.keys: W/A/D/E) and steers state.player.yaw — walked, never
// teleported; writes nothing the HUD reads (HUD comes from the real sim via syncShotHud).
import { state } from './state.js';
import { NODES, NEXT_HOP, ADJACENT, nearestNode, lineClear } from './bots.js';

const ARRIVE = 1.2; // waypoint reached radius (matches the bots' patrol tolerance)
const STUCK_STEPS = 30; // ~0.5 s of barely moving triggers a side-step
const DEFUSE_RANGE = 3.5; // safely inside rounds.js's 4 m defuse radius

let sites = null;
let shotName = '';
let vantage = -1; // route node the 'play' shot holds, with a clear line onto a patrolled lane
let vantageLane = -1; // the lane node it watches (the hold faces this way)
let assignedSite = null;
let assignedRound = -1;
let lastX = 0;
let lastZ = 0;
let stuckSteps = 0;
let strafeHold = 0;
let side = 0;

export function initShotPlayer(world, name) {
  sites = world.sites;
  shotName = name || '';
}

// Nearest site zone to where the player currently stands, remembered for the round.
function pickSite() {
  let best = 'A';
  let bestDist = Infinity;
  for (const key of Object.keys(sites)) {
    const c = sites[key].center;
    const d = Math.hypot(c.x - state.player.position.x, c.z - state.player.position.z);
    if (d < bestDist) { bestDist = d; best = key; }
  }
  assignedSite = best;
  assignedRound = state.round.number;
}

function releaseKeys() {
  const keys = state.input.keys;
  keys.delete('KeyW');
  keys.delete('KeyA');
  keys.delete('KeyD');
  keys.delete('KeyE');
}

// Walk one simulated step of the scripted player (called from main.js's step()).
export function updateShotPlayer(dt) { // dt unused: keyed movement is impulse-based
  const player = state.player;
  if (!player.alive) { releaseKeys(); return; }
  const bomb = state.round.bomb;
  const phase = state.round.phase;
  const keys = state.input.keys;

  // Bomb down: attackers post up watching it; defenders run in and defuse.
  if (bomb.state === 'planted') {
    releaseKeys();
    const d = Math.hypot(bomb.x - player.position.x, bomb.z - player.position.z);
    if (player.team === 1) {
      if (d > DEFUSE_RANGE) walkToward(player, keys, bomb.x, bomb.z);
      else keys.add('KeyE');
      return;
    }
    player.yaw = Math.atan2(-(bomb.x - player.position.x), -(bomb.z - player.position.z));
    return;
  }

  if (phase !== 'live') { releaseKeys(); return; } // freeze/round_end: nobody moves

  // Pick the goal: the bomb itself unless the player is carrying it.
  if (bomb.carrier === 'player') {
    if (assignedRound !== state.round.number || !assignedSite) pickSite();
    const site = sites[assignedSite];
    const inside = player.position.x >= site.min.x && player.position.x <= site.max.x
      && player.position.z >= site.min.z && player.position.z <= site.max.z;
    if (inside) {
      releaseKeys();
      keys.add('KeyE'); // hold the plant; rounds.js completes it after 3 s
      return;
    }
    walkToward(player, keys, site.center.x, site.center.z);
    return;
  }
  // Bomb on a teammate bot (escort it) or on the ground (pick it up): go to the bomb —
  // except in the 'play' capture, where framing beats fetching: hold a lane vantage
  // with line-of-sight onto a patrolled route instead (the plant goal above still wins
  // whenever the player carries the bomb).
  if (shotName !== 'play') {
    keys.delete('KeyE');
    walkToward(player, keys, bomb.x, bomb.z);
    return;
  }
  engageFromVantage(player, keys);
}

// Every node any team's patrol touches (sides swap at the half, so both lists count).
const PATROL_NODES = [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const VANTAGE_RANGE = 24; // a hair under the bots' 25 m gunshot-hear range

// Nearest route node with a clear ≤VANTAGE_RANGE line onto a patrolled lane; the lane
// node it watches is remembered so the hold faces the right way. Static node data plus
// the seeded world make this deterministic — computed once, first live tick.
function pickVantage(px, pz) {
  let bestDist = Infinity;
  for (let i = 0; i < NODES.length; i += 1) {
    for (const lane of PATROL_NODES) {
      if (lane === i) continue;
      const d = Math.hypot(NODES[i].x - NODES[lane].x, NODES[i].z - NODES[lane].z);
      if (d > VANTAGE_RANGE) continue;
      if (!lineClear(NODES[i].x, NODES[i].z, NODES[lane].x, NODES[lane].z)) continue;
      const pd = Math.hypot(NODES[i].x - px, NODES[i].z - pz);
      if (pd < bestDist) { bestDist = pd; vantage = i; vantageLane = lane; }
    }
  }
}

// Walk to the vantage, then hold: stop, face the watched lane. The trigger itself stays
// in main.js's playerFire, which now only squeezes while an enemy is actually visible.
function engageFromVantage(player, keys) {
  if (vantage < 0) pickVantage(player.position.x, player.position.z);
  if (vantage < 0) {
    keys.delete('KeyE');
    walkToward(player, keys, state.round.bomb.x, state.round.bomb.z);
    return;
  }
  const vx = NODES[vantage].x;
  const vz = NODES[vantage].z;
  if (Math.hypot(vx - player.position.x, vz - player.position.z) > ARRIVE) {
    keys.delete('KeyE');
    walkToward(player, keys, vx, vz);
    return;
  }
  releaseKeys();
  player.yaw = Math.atan2(-(NODES[vantageLane].x - vx), -(NODES[vantageLane].z - vz));
}

// Face and walk toward (gx, gz). Straight lines only when they actually clear the world;
// otherwise hop through the shared route graph — and when nearestNode snaps to the goal's
// node from across a wall, retreat through the first clear neighbouring node instead of
// walking into the wall forever.
function walkToward(player, keys, gx, gz) {
  const px = player.position.x;
  const pz = player.position.z;
  const here = nearestNode(px, pz);
  const there = nearestNode(gx, gz);
  let tx = gx;
  let tz = gz;
  if (!lineClear(px, pz, gx, gz)) {
    let hop = here !== there ? NEXT_HOP[here][there] : -1;
    if (hop < 0 || hop === here) {
      for (const neighbour of ADJACENT[here]) {
        if (lineClear(px, pz, NODES[neighbour].x, NODES[neighbour].z)) { hop = neighbour; break; }
      }
    }
    if (hop >= 0 && hop !== here) { tx = NODES[hop].x; tz = NODES[hop].z; }
  }
  player.yaw = Math.atan2(-(tx - player.position.x), -(tz - player.position.z));
  keys.add('KeyW');
  keys.delete('KeyA');
  keys.delete('KeyD');
  // Unstick: after STUCK_STEPS of barely moving, side-step for a stretch on the
  // deterministic opposite side, then try straight again.
  const moved = Math.hypot(player.position.x - lastX, player.position.z - lastZ);
  lastX = player.position.x;
  lastZ = player.position.z;
  stuckSteps = moved < 0.02 ? stuckSteps + 1 : 0;
  if (stuckSteps >= STUCK_STEPS) {
    side = side === 0 ? 1 : 0;
    strafeHold = STUCK_STEPS;
    stuckSteps = 0;
  }
  if (strafeHold > 0) {
    strafeHold -= 1;
    keys.add(side === 0 ? 'KeyD' : 'KeyA');
  }
}
