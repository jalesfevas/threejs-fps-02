// Entry point for the threejs-fps-02 submission (Node 22, standard library only).
//
// What this program does, in order:
//   1. makes sure the destination directory exists;
//   2. copies the game itself (the game/ folder, plain static files the browser
//      loads as ES modules with three.js via an import map) into the output;
//   3. copies the screenshots/ folder (first file by name becomes the cover);
//   4. writes dossier.json — the summary the judge reads — via the vendored
//      make.fun library.
//
// Run locally with `node serve.ts` and open http://localhost:8080.
// Outside the grader's container MAKEFUN_OUTPUT_DIR replaces /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// Everything is deterministic: no clocks, no randomness, so two runs over the
// same tree produce byte-identical output.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outRoot = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Mirror one source folder into the destination, keeping relative paths.
function copyTree(srcName: string): void {
  const src = join(repoRoot, srcName);
  if (!existsSync(src)) return;
  cpSync(src, join(outRoot, srcName), { recursive: true });
}

mkdirSync(outRoot, { recursive: true });

copyTree('game');
console.log('copied game');

mkdirSync(join(outRoot, 'screenshots'), { recursive: true });
copyTree('screenshots');
console.log('copied screenshots');

// Caps mirror the scorer's own limits (reference/gate.json): only text_max_bytes
// shapes the bytes; the rest reject an entry the scorer would reject anyway
// (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or
// 48 MiB of game files — game/ counts alongside output's own 1000-entry cap
// covering its screenshots/ and dossier.json too).
function writeDossier(): number {
  const dossier = buildDossier(outRoot, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  });
  writeFileSync(join(outRoot, 'dossier.json'), dossier);
  return Buffer.byteLength(dossier);
}
console.log(`dossier: ${writeDossier()} bytes`);
