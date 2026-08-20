import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The zomes must not be built against a newer HDK than the conductor Moss
 * actually ships.
 *
 * Neither test suite can catch this. A zome built with a later 0.6.x HDK emits
 * an import for a host function the older conductor does not provide, and the
 * only symptom is at applet load, inside Moss:
 *
 *   ModuleBuild("ark: Error while importing \"env\".\"__hc__get_init_properties_1\":
 *   unknown import")
 *
 * The DNA suite runs against holonix `main-0.6`, whose conductor is 0.6.3 and
 * does provide that function — so the same wasm passes every test and fails in
 * the only environment that matters. Hence a check on the pin itself.
 *
 * Raise these only together with the conductor Moss bundles, which lives at
 * node_modules/@theweave/cli/dist/main/resources/bins/holochain-v*.
 */
const EXPECTED = { hdk: '0.6.1', hdi: '0.7.1' };
const MOSS_CONDUCTOR = '0.6.1';

function lockedVersion(lock: string, crate: string): string | undefined {
  // Cargo.lock is a sequence of [[package]] blocks; take the version line that
  // follows this crate's name line.
  const match = new RegExp(`name = "${crate}"\\nversion = "([^"]+)"`).exec(lock);
  return match?.[1];
}

describe('rust toolchain pins', () => {
  const root = join(__dirname, '..', '..');
  const lock = readFileSync(join(root, 'Cargo.lock'), 'utf8');
  const manifest = readFileSync(join(root, 'Cargo.toml'), 'utf8');

  for (const [crate, version] of Object.entries(EXPECTED)) {
    it(`resolves ${crate} to exactly ${version}, matching Moss's conductor`, () => {
      expect(lockedVersion(lock, crate)).toEqual(version);
    });

    it(`pins ${crate} exactly, so cargo update cannot float it past the conductor`, () => {
      // `=` matters: a caret requirement lets `cargo update` walk forward to a
      // patch whose host-function imports the bundled conductor lacks.
      expect(manifest).toContain(`${crate} = { version = "=${version}" }`);
    });
  }

  it('matches the conductor binary the installed Moss CLI actually bundles', () => {
    // The pins above are only correct relative to this binary, so read it
    // rather than restating it. If the CLI is not installed there is nothing
    // to compare against and the check has no opinion.
    const bins = join(root, 'node_modules/@theweave/cli/dist/main/resources/bins');
    if (!existsSync(bins)) return;
    const conductor = readdirSync(bins).find((f) => f.startsWith('holochain-v'));
    expect(conductor).toEqual(`holochain-v${MOSS_CONDUCTOR}`);
  });
});
