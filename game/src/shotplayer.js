// Scripted player driver for ?shot= captures ONLY. Feeds the same input snapshot the real
// player reads (state.input.keys: W/A/D/E) and steers state.player.yaw — walked, never
// teleported; writes nothing the HUD reads (HUD comes from the real sim via syncShotHud).
import { state } from './state.js';
import { NODES, NEXT_HOP, ADJACENT, nearestNode, lineClear } from './bots.js';

const ARRIVE = 1.2; // waypoint reached radius (matches the bots' patrol tolerance)
const STUCK_STEPS = 30; // ~0.5 s of barely moving triggers a side-step
const DEFUSE_RANGE = 3.5; // safely inside rounds.js's 4 m defuse radius

let sites = null;
let assignedSite = null;
let assignedRound = -1;
let lastX = 0;
let lastZ = 0;
let stuckSteps = 0;
let strafeHold = 0;
let side = 0;

export function initShotPlayer(world) {
  sites = world.sites;
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
  // Bomb on a teammate bot (escort it) or on the ground (pick it up): go to the bomb.
  keys.delete('KeyE');
  walkToward(player, keys, bomb.x, bomb.z);
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
