// Round flow: FREEZE (buy time, no damage) → LIVE (60 s) → PLANTED (bomb ticking) →
// ROUND_END (4 s banner) → next round, until one side reaches 5 wins → MATCH_END + restart.
// The objective (plant/defuse) lives here too; the economy is economy.js.
import { state } from './state.js';

const ROUND_TIME = 60;
const FREEZE_TIME = 5;
const BOMB_TIME = 25;
const PLANT_TIME = 3;
const DEFUSE_TIME = 7;
const DEFUSE_RANGE = 4;
const ROUND_END_TIME = 4;
const WIN_SCORE = 5;

export function initRounds(deps) {
  deps_ = deps; // { world, player, respawnBots, respawnPlayer, hud, onBuyPhase }
  state.round.phase = 'freeze';
  state.round.timer = FREEZE_TIME;
  state.round.number = 0;
  state.round.score = [0, 0]; // [attackers(player team), defenders]
  state.round.banner = '';
  state.round.bomb = {
    carrier: 'player', // who carries it: 'player' or a bot index
    state: 'carried', // carried | planted | exploded | defused
    site: null,
    x: 0, y: 0, z: 0,
    timer: 0,
    progress: 0, // plant/defuse hold progress 0..1
  };
  startRound();
}

let deps_ = null;

// Full reset for one round: players and bots back to their spawns, health full, bomb with
// the player (the player team always attacks).
function startRound() {
  state.round.number += 1;
  state.round.phase = 'freeze';
  state.round.timer = FREEZE_TIME;
  const spawns = deps_.world.spawns;
  deps_.respawnPlayer(spawns.attackers[0].position);
  deps_.respawnBots();
  state.round.bomb.state = 'carried';
  state.round.bomb.carrier = 'player';
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
  if (bomb.state === 'carried') updatePlant(dt);
  else if (bomb.state === 'planted') updateDefuse(dt);
  else deps_.hud.setProgress(-1, '');
}

// Defuse: a defender (bot or, were the player one, the player) within 4 m of the bomb holds
// the objective for 7 s. Bots defuse automatically when close; progress resets when they
// step away or die.
function updateDefuse(dt) {
  const bomb = state.round.bomb;
  let working = false;
  for (const bot of state.bots) {
    if (bot.team !== 1 || !bot.alive) continue;
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

// Teams are 0 = attackers (player team), 1 = defenders. Elimination of one side decides the
// round, except when the bomb is down — then only defuse or detonation can end it.
function checkElimination() {
  const attackersDown = state.player.alive === false && aliveBots(0) === 0;
  const defendersDown = aliveBots(1) === 0;
  if (state.round.bomb.state === 'planted') {
    if (defendersDown) endRound(0, 'Defenders eliminated — attackers win');
    return;
  }
  if (attackersDown) endRound(1, 'Attackers eliminated — defenders win');
  else if (defendersDown) endRound(0, 'Defenders eliminated — attackers win');
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

// Plant: the carrier (player) holds E for 3 s inside a site zone during LIVE.
function updatePlant(dt) {
  const bomb = state.round.bomb;
  const inSite = siteAt(state.player.position.x, state.player.position.z);
  if (inSite && holdingUse()) {
    bomb.progress = Math.min(1, bomb.progress + dt / PLANT_TIME);
    deps_.hud.setProgress(bomb.progress, 'planting');
    if (bomb.progress >= 1) {
      bomb.state = 'planted';
      bomb.site = inSite;
      bomb.x = state.player.position.x;
      bomb.y = state.player.position.y;
      bomb.z = state.player.position.z;
      bomb.timer = BOMB_TIME;
      bomb.progress = 0;
      state.round.phase = 'planted';
      state.round.timer = BOMB_TIME; // round clock is now the bomb clock
      deps_.hud.setProgress(-1, '');
      deps_.hud.setBanner('Bomb planted');
      deps_.onPlant?.(inSite);
    }
  } else {
    bomb.progress = Math.max(0, bomb.progress - dt * 2);
    deps_.hud.setProgress(bomb.progress > 0 ? bomb.progress : -1, 'planting');
  }
}
