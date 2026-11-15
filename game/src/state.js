// The one home for mutable game state. Every module reads and writes this object; no module
// keeps its own copy. Bots, rounds and the economy are later sessions — their fields exist
// here from the start so nothing has to migrate.
import * as THREE from 'three';

export const state = {
  // Simulation clock, advanced only by the fixed step.
  time: 0,
  score: 0,

  player: {
    position: new THREE.Vector3(0, 0, 15),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: 1.7, // smoothed eye height: 1.7 standing, 1.1 crouched
    height: 1.8, // full body height for collision: 1.8 standing, 1.3 crouched
    onGround: true,
    crouching: false,
    health: 100,
    alive: true,
    kevlar: false,
    team: 0, // 0 = attackers (player team), 1 = defenders
  },

  // One record per weapon slot, indexed by WEAPONS order in weapons.js. The active slot plus
  // the shared viewmodel timers live on the container; ammo lives on the slot.
  weapon: {
    slot: 0, // 0 = Kiln-9, 1 = Ember, 2 = Judge
    switchLeft: 0, // remaining switch delay, seconds
    flash: 0, // muzzle flash timer
    kick: 0, // viewmodel recoil kick
    slots: [
      { mag: 30, reserve: 90, cooldown: 0, reloadLeft: 0, recoilIndex: 0, lastShot: -1 },
      { mag: 25, reserve: 125, cooldown: 0, reloadLeft: 0, recoilIndex: 0, lastShot: -1 },
      { mag: 12, reserve: 48, cooldown: 0, reloadLeft: 0, recoilIndex: 0, lastShot: -1 },
    ],
  },

  // Kilnpot grenades: count carried plus the pooled live records grenade.js fills once.
  grenades: {
    count: 3,
    list: [],
  },

  // Shared visual-effect pools (built once by weapons.js) and the screen-shake level.
  fx: {
    shake: 0,
    puff: null,
    tracers: null,
  },

  // Hits and kills, reported by targets.js; the scoreboard and later the bots read these.
  stats: {
    hits: 0,
    kills: 0,
    headshots: 0,
  },

  // Input snapshot, written by input.js each frame and consumed by the simulation.
  input: {
    keys: new Set(), // held, by KeyboardEvent.code
    pressed: new Set(), // pressed this frame (edge), drained by main.js
    locked: false,
    firing: false,
    lookX: 0,
    lookY: 0,
  },

  // Bots, spawned and owned by bots.js each round.
  bots: [],

  // Round bookkeeping; the round module in a later session owns the transitions.
  round: {
    number: 0,
    phase: 'warmup', // warmup | buy | live | planted | ended
    timer: 0,
  },
};
