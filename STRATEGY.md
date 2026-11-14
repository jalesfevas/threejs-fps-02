# STRATEGY — threejs-fps-02

## What the sealed rubric weighs, in order (judge reads screenshots + source, never runs the game)

1. **A complete game** — first-person view, mouse look + keyboard move, weapon that fires/reloads/runs
   out of ammo, opponents that move/see/shoot back, rounds that end in win-or-loss and restart, HUD
   with health, ammunition, round timer and score. Screenshots and code must agree.
2. **Gunplay & movement** — hit detection against bodies with headshot damage, recoil and spread that
   punish firing on the move, acceleration, crouching, map collision.
3. **Tactics** — an objective beyond killing (bomb plant/defuse), per-round money and a buy menu, more
   than one weapon, at least one grenade, bots that follow routes, hold positions and react to what
   they see and hear.
4. **Map & look** — an original map with lanes, corners and sightlines; chosen palette, lighting, a
   scene that reads at a glance.
5. **Code** — modules with one job, fixed-step simulation separate from rendering, no per-frame
   allocations in hot loops, one place for state, no duplicated or dead code.

Rank is a pairwise **win rate** (Bradley-Terry); margin 1 = 0.6, margin 5 = 1.0. Top 12 after 6 Swiss
rounds enter a playoff; the 10 best take the money. Ties break by smaller `dossier.json`, then earlier
receipt. The first criterion that differs decides — a game missing any "complete" item loses outright.

## Field and odds (measured at entry)

- 0 entrants at our entry; 10 paid places; deadline 2026-11-16T21:30Z (48 h from open); 5 submits/day.
- The starter, handed in unchanged, plays as fixed house game #2 — we must be decisively above it.
- House games run from weak to strong; the dev heat measures us against 4 fixed games + 3 rungs and
  shows a provisional rate at once, so every iteration is measured, not guessed.

## How we win each criterion

1. Everything in criterion 1 exists and works in a 60 s browser session; the four screenshots show:
   spawn/buy menu, mid-fight muzzle flash + HUD, bomb planted, scoreboard/round end.
2. Hitscan rays with head/body multipliers, per-weapon recoil pattern and movement inaccuracy, WASD +
   acceleration + crouch (speed and height change) + AABB collision against map boxes.
3. Attackers plant a charge at site A/B (hold E in zone), defenders defuse (hold E, timer bar); money
   per round + kill, buy menu on B with rifle / SMG / pistol / grenade; bots walk waypoint routes,
   stop at pre-set hold spots, and turn toward the last sound/shot they perceived.
4. Original map "Kiln Yard" — a ceramics yard: two lanes + mid, crate sightlines, a kiln as site A
   landmark, warm dusk palette, one hemisphere + one directional light, fog for depth.
5. `src/` modules with one job (`world`, `player`, `weapons`, `bots`, `rounds`, `economy`, `hud`,
   `input`, `palette`), a fixed 60 Hz simulation step in an accumulator loop, all mutable state in one
   `state.js` object, zero allocations inside the step (pools for bullets/particles), no dead code.

## Constraints we must not break

- game/ = plain files, ≤993 entries, ≤48 MiB; index.html ≤1 MiB with exactly one import map mapping
  `"three"` → `./vendor/three/three.module.min.js`; the two vendored three.js 0.187.0 files byte for byte.
- No network requests; every reference relative and inside game/; screenshots 3–4 PNG/JPEG, ≤256 KiB
  each, long side ≤1280, short side ≥480, real renders of our game, first by name = cover.
- `main.ts` copies game/ + screenshots/ to /output and writes dossier.json via `buildDossier`; two runs
  must write identical bytes (deterministic by construction — it only copies and hashes).
- Transcripts: all game code is written by our own recorded agent sessions (bundle `--hermes-dir`),
  ≥30 % authored lines, entrypoint authored, ≥5 turns, entrypoint revised in ≥2 messages.
- Quota 5/day, 10 total. Final pick: the last submission counts unless we set `final-entry`.
