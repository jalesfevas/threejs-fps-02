// Round flow: FREEZE (buy time, no damage) → LIVE (60 s) → PLANTED (bomb ticking) →
// ROUND_END (4 s banner) → next round, until one side reaches 5 wins → MATCH_END + restart.
// The objective (plant/defuse) lives here too; the economy is economy.js.
import { state } from './state.js';
import { WEAPONS } from './weapons.js';
import { applyTeams } from './bots.js';

const ROUND_TIME = 60;
const FREEZE_TIME = 5;
const BOMB_TIME = 25;
const PLANT_TIME = 3;
const DEFUSE_TIME = 7;
const DEFUSE_RANGE = 4;
const PICKUP_RANGE = 1.5;
const ROUND_END_TIME = 4;
const WIN_SCORE = 5;

export function initRounds(deps) {
  deps_ = deps; // { world, player, respawnBots, respawnPlayer, hud, onBuyPhase }
  state.round.phase = 'freeze';
  state.round.timer = FREEZE_TIME;
  state.round.number = 0;
  state.round.score = [0, 0]; // [attackers(player team), defenders]
  state.round.banner = '';
  state.round.lastWinner = null; // set by endRound, read by the next startRound
  state.round.playerSurvived = true;
  state.round.bomb = {
    carrier: 'player', // who carries it: 'player', a bot index, or null while dropped
    state: 'carried', // carried | dropped | planted | exploded | defused
    site: null,
    x: 0, y: 0, z: 0,
    timer: 0,
    progress: 0, // plant/defuse hold progress 0..1
  };
  startRound();
}

let deps_ = null;

// Full reset for one round: sides swap at the half (rounds 1-5 the player attacks, 6+ the
// player defends), everyone is back at their side's spawns with full health, and the bomb
// starts with an attacker.
function startRound() {
  state.round.number += 1;
  state.round.phase = 'freeze';
  state.round.timer = FREEZE_TIME;
  const playerTeam = state.round.number <= 5 ? 0 : 1;
  state.player.team = playerTeam;
  state.round.playerTeam = playerTeam;
  applyTeams(playerTeam);
  const spawns = deps_.world.spawns;
  deps_.respawnPlayer(playerTeam === 0 ? spawns.attackers[0].position : spawns.defenders[0].position);
  deps_.respawnBots();
  // Loadout carry-over: kevlar cleared unless bought this round; ammo refilled to full
  // magazines; a player on the losing side who died is reset to the pistol and loses
  // their grenades.
  if (state.economy?.kevlarRound !== state.round.number) state.player.kevlar = false;
  const resetToPistol = state.round.lastWinner != null
    && state.round.lastWinner !== state.round.playerTeam && !state.round.playerSurvived;
  for (let i = 0; i < WEAPONS.length; i += 1) {
    const slot = state.weapon.slots[i];
    if (resetToPistol && i < 2) { slot.mag = 0; slot.reserve = 0; continue; }
    slot.mag = WEAPONS[i].mag;
    slot.reserve = WEAPONS[i].reserve;
  }
  if (!state.round.playerSurvived) state.grenades.count = 0;
  if (resetToPistol) {
    state.weapon.slot = 2;
  }
  state.round.bomb.state = 'carried';
  // The bomb starts with an attacker: the player in their half, else the first attacker bot.
  state.round.bomb.carrier = playerTeam === 0 ? 'player' : 2;
  state.round.bomb.site = null;
  state.round.bomb.progress = 0;
  deps_.hud.setBanner('');
  deps_.hud.setRound(state.round.number, state.round.score);
}

export function updateRounds(dt) {
  if (!deps_ || state.round.phase === 'match_end') return;
  state.round.timer -= dt;
  const { phase } = state.round;
  if (phase === 'freeze') {
    if (state.round.timer <= 0) goLive();
  } else if (phase === 'live') {
    updateObjective(dt);
    checkElimination();
    if (state.round.phase === 'live' && state.round.timer <= 0) endRound(1, 'Defenders win — time ran out');
  } else if (phase === 'planted') {
    updateObjective(dt);
    checkElimination();
    if (state.round.phase === 'planted') {
      state.round.bomb.timer -= dt;
      if (state.round.bomb.timer <= 0) {
        state.round.bomb.state = 'exploded';
        endRound(0, 'The bomb detonated — attackers win');
      }
    }
  } else if (phase === 'round_end') {
    if (state.round.timer <= 0) {
      if (state.round.score[0] >= WIN_SCORE || state.round.score[1] >= WIN_SCORE) {
        state.round.phase = 'match_end';
        state.round.timer = 0;
        deps_.hud.showMatchEnd(state.round.score);
        deps_.onMatchEnd?.();
      } else {
        startRound();
      }
    }
  }
}

// LIVE starts: unfreeze, open the buy window (economy.js listens), clear the banner.
function goLive() {
  state.round.phase = 'live';
  state.round.timer = ROUND_TIME;
  state.round.banner = '';
  deps_.hud.setBanner('');
  if (deps_.onBuyClose) deps_.onBuyClose();
}

// Dispatch per phase; only runs in live/planted (guarded by updateRounds).
function updateObjective(dt) {
  const bomb = state.round.bomb;
  if (bomb.state === 'carried') {
    // A dead carrier drops the bomb where they fell.
    const carrier = carrierBot();
    const dead = bomb.carrier === 'player' ? !state.player.alive : !(carrier && carrier.alive);
    if (dead) {
      const pos = bomb.carrier === 'player' ? state.player.position : carrier.position;
      bomb.state = 'dropped';
      bomb.carrier = null;
      bomb.x = pos.x;
      bomb.y = Math.max(0, pos.y);
      bomb.z = pos.z;
      bomb.progress = 0;
      deps_.hud.setBanner('Bomb dropped');
      return;
    }
    updatePlant(dt);
  } else if (bomb.state === 'dropped') {
    updatePickup();
  } else if (bomb.state === 'planted') {
    updateDefuse(dt);
  } else {
    deps_.hud.setProgress(-1, '');
  }
}

function carrierBot() {
  const { carrier } = state.round.bomb;
  return typeof carrier === 'number' ? state.bots[carrier] : null;
}

// Any living attacker (player or bot) walking within 1.5 m of a dropped bomb picks it up.
function updatePickup() {
  const bomb = state.round.bomb;
  const near = (pos) => Math.hypot(pos.x - bomb.x, pos.z - bomb.z) <= PICKUP_RANGE;
  if (state.player.team === 0 && state.player.alive && near(state.player.position)) {
    bomb.state = 'carried';
    bomb.carrier = 'player';
  } else {
    for (const bot of state.bots) {
      if (bot.team !== 0 || !bot.alive || !near(bot.position)) continue;
      bomb.state = 'carried';
      bomb.carrier = bot.slot;
      break;
    }
  }
  if (bomb.state === 'carried') deps_.hud.setBanner('');
}

// Defuse: a defender (bot or the player) within 4 m of the bomb holds the objective for 7 s.
// Bots defuse automatically when close; the player holds E. Progress resets when they step
// away or die. Live for the player in the second half, when the player defends.
function updateDefuse(dt) {
  const bomb = state.round.bomb;
  let working = false;
  for (const bot of state.bots) {
    if (bot.team !== 1 || !bot.alive || bot.seesEnemy) continue;
    if (Math.hypot(bot.position.x - bomb.x, bot.position.z - bomb.z) > DEFUSE_RANGE) continue;
    working = true;
    break;
  }
  if (!working && state.player.team === 1 && state.player.alive
    && Math.hypot(state.player.position.x - bomb.x, state.player.position.z - bomb.z) <= DEFUSE_RANGE) {
    working = holdingUse();
  }
  if (working) {
    bomb.progress = Math.min(1, bomb.progress + dt / DEFUSE_TIME);
    deps_.hud.setProgress(bomb.progress, 'defusing');
    if (bomb.progress >= 1) {
      bomb.state = 'defused';
      deps_.hud.setProgress(-1, '');
      endRound(1, 'Bomb defused — defenders win');
    }
  } else {
    bomb.progress = 0;
    deps_.hud.setProgress(-1, '');
  }
}

// Teams are 0 = attackers, 1 = defenders; the player counts on their round's team (sides
// swap at the half). Elimination of one side decides the round, except when the bomb is
// down — then only defuse or detonation can end it.
function checkElimination() {
  const attackersLeft = aliveBots(0) + (state.player.team === 0 && state.player.alive ? 1 : 0);
  const defendersLeft = aliveBots(1) + (state.player.team === 1 && state.player.alive ? 1 : 0);
  if (state.round.bomb.state === 'planted') {
    if (defendersLeft === 0) endRound(0, 'Defenders eliminated — attackers win');
    return;
  }
  if (attackersLeft === 0) endRound(1, 'Attackers eliminated — defenders win');
  else if (defendersLeft === 0) endRound(0, 'Defenders eliminated — attackers win');
}

function aliveBots(team) {
  let count = 0;
  for (const bot of state.bots) if (bot.team === team && bot.alive) count += 1;
  return count;
}

function endRound(winner, banner) {
  if (state.round.phase === 'round_end' || state.round.phase === 'match_end') return;
  state.round.phase = 'round_end';
  state.round.timer = ROUND_END_TIME;
  state.round.score[winner] += 1;
  state.round.banner = banner;
  state.round.lastWinner = winner;
  state.round.playerSurvived = state.player.alive;
  deps_.hud.setBanner(banner);
  deps_.hud.setRound(state.round.number, state.round.score);
  deps_.onRoundEnd?.(winner);
}

// --- Bomb objective -------------------------------------------------------------------------

function holdingUse() {
  return state.input.keys.has('KeyE');
}

// Which site zone (if any) contains the point (xz).
function siteAt(x, z) {
  for (const site of Object.values(deps_.world.sites)) {
    if (x >= site.min.x && x <= site.max.x && z >= site.min.z && z <= site.max.z) return site;
  }
  return null;
}

// Plant: the carrier (player holds E, or a bot standing in the zone with no enemy visible)
// completes a 3 s hold inside a site zone during LIVE.
function updatePlant(dt) {
  const bomb = state.round.bomb;
  let source = null;
  let inSite = null;
  if (bomb.carrier === 'player') {
    source = state.player.position;
    inSite = state.player.alive && siteAt(source.x, source.z);
    if (inSite && holdingUse()) {
      bomb.progress = Math.min(1, bomb.progress + dt / PLANT_TIME);
      deps_.hud.setProgress(bomb.progress, 'planting');
      if (bomb.progress >= 1) plantNow(inSite, source.x, source.y, source.z);
      return;
    }
  } else {
    const bot = carrierBot();
    if (bot && bot.alive) {
      source = bot.position;
      inSite = siteAt(source.x, source.z);
      if (inSite && !bot.seesEnemy) {
        bomb.progress = Math.min(1, bomb.progress + dt / PLANT_TIME);
        deps_.hud.setProgress(bomb.progress, 'planting');
        if (bomb.progress >= 1) plantNow(inSite, source.x, source.y, source.z);
        return;
      }
    }
  }
  bomb.progress = Math.max(0, bomb.progress - dt * 2);
  deps_.hud.setProgress(bomb.progress > 0 ? bomb.progress : -1, 'planting');
}

// Shared completion: fix the bomb where it was planted, switch to the PLANTED phase.
function plantNow(site, x, y, z) {
  const bomb = state.round.bomb;
  bomb.state = 'planted';
  bomb.site = site;
  bomb.x = x;
  bomb.y = Math.max(0, y);
  bomb.z = z;
  bomb.timer = BOMB_TIME;
  bomb.progress = 0;
  state.round.phase = 'planted';
  state.round.timer = BOMB_TIME; // round clock is now the bomb clock
  deps_.hud.setProgress(-1, '');
  deps_.hud.setBanner('Bomb planted');
  deps_.onPlant?.(site);
}
