#!/usr/bin/env node
/**
 * Shrink the coordinator zome wasms with `wasm-opt -Oz`, in place.
 *
 * Coordinator zomes ONLY, deliberately. A DNA's hash is derived from its
 * integrity zomes; coordinators are swappable and do not contribute to it.
 * Optimising an integrity wasm therefore changes the DNA hash, which means an
 * optimised release build and an unoptimised `npm run build:happ` would form
 * two different networks — peers on one silently unable to see the other. That
 * is a miserable thing to debug, and the saving does not buy it: the
 * coordinators are about two thirds of the bytes here.
 *
 * Which zome is which is read from the DNA manifest rather than guessed from
 * file names, so adding a zome cannot quietly opt it into the wrong group.
 *
 * Needs `wasm-opt` on PATH — the flake provides it via `binaryen`, so run this
 * inside `nix develop`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, renameSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { load } from 'js-yaml';

const MANIFEST = 'dnas/ark/workdir/dna.yaml';

const manifest = load(readFileSync(MANIFEST, 'utf8'));
const base = dirname(resolve(MANIFEST));

const coordinators = (manifest?.coordinator?.zomes ?? []).map((z) => ({
  name: z.name,
  path: resolve(base, z.path),
}));
const integrity = (manifest?.integrity?.zomes ?? []).map((z) => z.name);

if (coordinators.length === 0) {
  console.error(`No coordinator zomes found in ${MANIFEST}`);
  process.exit(1);
}

console.log(`Leaving ${integrity.length} integrity zome(s) untouched: ${integrity.join(', ')}`);
console.log(`  (they determine the DNA hash — see the note at the top of this script)\n`);

let before = 0;
let after = 0;

for (const zome of coordinators) {
  const sizeBefore = statSync(zome.path).size;
  const tmp = `${zome.path}.opt`;
  execFileSync('wasm-opt', ['-Oz', '--strip-debug', '--strip-producers', zome.path, '-o', tmp], {
    stdio: 'inherit',
  });
  const sizeAfter = statSync(tmp).size;
  renameSync(tmp, zome.path);

  before += sizeBefore;
  after += sizeAfter;
  const pct = (((sizeBefore - sizeAfter) / sizeBefore) * 100).toFixed(1);
  console.log(
    `  ${zome.name.padEnd(24)} ${(sizeBefore / 1024).toFixed(0).padStart(6)} KB -> ` +
      `${(sizeAfter / 1024).toFixed(0).padStart(6)} KB  (-${pct}%)`,
  );
}

const pct = (((before - after) / before) * 100).toFixed(1);
console.log(
  `\n  total${' '.repeat(20)} ${(before / 1024).toFixed(0).padStart(6)} KB -> ` +
    `${(after / 1024).toFixed(0).padStart(6)} KB  (-${pct}%)`,
);
