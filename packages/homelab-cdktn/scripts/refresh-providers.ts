#!/usr/bin/env bun
/**
 * Applies the provider pins in `packages/homelab/src/tofu/provider-versions.json`:
 * moves each stack's `.terraform.lock.hcl` to the pinned versions, regenerates
 * the provider bindings and re-synthesizes every stack.
 *
 *   bun run --cwd packages/homelab-cdktn providers:refresh            # synthesized stacks
 *   bun run --cwd packages/homelab-cdktn providers:refresh -- argocd  # named stacks, any format
 *   bun run --cwd packages/homelab-cdktn providers:refresh -- --check # report only, exit 1 when stale
 *
 * It only reads provider registries and writes lock files, bindings and
 * synthesized JSON. It never initializes a backend, so it cannot touch state.
 *
 * By default only synthesized stacks are refreshed: a hand-written HCL stack's
 * lock is still maintained by Renovate's terraform manager and may run ahead
 * of the pin until the stack is ported. Naming a stack refreshes it anyway,
 * which is how a port aligns its lock with the bindings it was written for.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadProviderPins,
  lockedProviders,
  providerAddress,
  requirePin,
} from "homelab/scripts/tofu/provider-versions.ts";
import type { ProviderPin } from "homelab/scripts/tofu/provider-versions.ts";

const packageRoot = path.resolve(import.meta.dir, "..");
const TOFU_ROOT = path.resolve(packageRoot, "../homelab/src/tofu");

export type LockChange = {
  address: string;
  locked: string;
  pinned: string;
};

/** Registry providers of one lock whose selection differs from the pin. */
export function staleLockEntries(
  lock: string,
  pins: readonly ProviderPin[],
): LockChange[] {
  return lockedProviders(lock).flatMap(({ address, version }) => {
    const pin = requirePin(pins, address);
    // A repository-built provider has no registry to lock from; `tofu init`
    // records it from the filesystem mirror on every run.
    return pin.local === true || pin.version === version
      ? []
      : [{ address, locked: version, pinned: pin.version }];
  });
}

/**
 * A root module requiring exactly the pinned versions of the given providers.
 * `tofu providers lock` on it yields their hashes for every platform.
 */
export function exactPinConfiguration(pins: readonly ProviderPin[]): string {
  return JSON.stringify({
    terraform: {
      required_providers: Object.fromEntries(
        pins.map((pin, index) => [
          `p${index.toString()}`,
          { source: providerAddress(pin), version: pin.version },
        ]),
      ),
    },
  });
}

async function tofu(
  args: string[],
  env: Record<string, string>,
): Promise<void> {
  const child = Bun.spawn(["tofu", ...args], {
    env: { ...Bun.env, ...env, TF_IN_AUTOMATION: "1" },
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0)
    throw new Error(
      `tofu ${args.join(" ")} failed (exit ${exitCode.toString()})`,
    );
}

/**
 * `lock` with each provider's `constraints` taken from `previous`.
 *
 * A lock records the version constraint of the configuration it was made
 * for. The pinned versions are locked from a scratch module that requires
 * exactly them, so its constraints are those exact versions; the stack's own
 * constraints are the ones its previous lock recorded.
 */
export function withConstraintsOf(lock: string, previous: string): string {
  const constraints = new Map<string, string>();
  for (const match of previous.matchAll(
    /^provider "(?<address>[^"]+)" \{\n\s*version\s*=\s*"[^"]+"\n\s*constraints\s*=\s*"(?<constraints>[^"]+)"/gmu,
  )) {
    const { address, constraints: value } = match.groups ?? {};
    if (address !== undefined && value !== undefined)
      constraints.set(address, value);
  }
  return lock.replaceAll(
    /^(?<head>provider "(?<address>[^"]+)" \{\n\s*version\s*=\s*"[^"]+"\n\s*constraints\s*=\s*)"[^"]+"/gmu,
    (block: string, head: string, address: string) => {
      const value = constraints.get(address);
      return value === undefined ? block : `${head}"${value}"`;
    },
  );
}

/**
 * Rewrites one stack's lock file to the pinned versions.
 *
 * OpenTofu keeps a locked selection that still satisfies the stack's
 * constraint, so the pinned versions are locked in a scratch module that
 * requires exactly them, which records their hashes for every platform. That
 * lock, carrying the stack's own constraints, replaces the stack's, and a
 * backend-less read-only `tofu init` in the stack proves the configuration
 * accepts it. A pin outside a stack's constraint fails there, and the
 * previous lock is restored.
 */
async function refreshLock(
  stack: string,
  pins: readonly ProviderPin[],
): Promise<void> {
  const stackDirectory = path.join(TOFU_ROOT, stack);
  const lockPath = path.join(stackDirectory, ".terraform.lock.hcl");
  const previous = await Bun.file(lockPath).text();
  const stackPins = lockedProviders(previous)
    .map(({ address }) => requirePin(pins, address))
    .filter((pin) => pin.local !== true);
  const scratch = await mkdtemp(path.join(tmpdir(), "tofu-provider-lock-"));
  try {
    const exact = path.join(scratch, "exact");
    await Bun.write(
      path.join(exact, "main.tf.json"),
      exactPinConfiguration(stackPins),
    );
    await tofu([`-chdir=${exact}`, "providers", "lock"], {});
    await Bun.write(
      lockPath,
      withConstraintsOf(
        await Bun.file(path.join(exact, ".terraform.lock.hcl")).text(),
        previous,
      ),
    );
    try {
      await tofu(
        [
          `-chdir=${stackDirectory}`,
          "init",
          "-backend=false",
          "-lockfile=readonly",
          "-input=false",
        ],
        { TF_DATA_DIR: path.join(scratch, "data") },
      );
    } catch (error) {
      await Bun.write(lockPath, previous);
      throw new Error(
        `${stack}: the stack's configuration rejects the refreshed lock; its previous lock is restored. When a pinned version is outside the stack's version constraint, widen the constraint in the stack's source (and re-synthesize), run \`tofu init -backend=false\` once to record it, then run providers:refresh again.`,
        { cause: error },
      );
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function runPackageScript(script: string): Promise<void> {
  const child = Bun.spawn(["bun", "run", script], {
    cwd: packageRoot,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0)
    throw new Error(`bun run ${script} failed (exit ${exitCode.toString()})`);
}

/**
 * Stacks holding a committed synthesis. Read from the tree rather than from
 * the app, whose stacks cannot be imported while their bindings are stale.
 */
async function synthesizedStacks(): Promise<string[]> {
  const files = await Array.fromAsync(
    new Bun.Glob("*/main.tf.json").scan({ cwd: TOFU_ROOT }),
  );
  return files.map((file) => path.dirname(file)).sort();
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  const check = args.includes("--check");
  const named = args.filter((argument) => !argument.startsWith("--"));
  const stacks = named.length > 0 ? named : await synthesizedStacks();
  const pins = await loadProviderPins();
  const stale = new Map<string, LockChange[]>();
  for (const stack of stacks) {
    const lock = Bun.file(path.join(TOFU_ROOT, stack, ".terraform.lock.hcl"));
    if (!(await lock.exists())) {
      // asuswrt: its only provider is built from this repository, so its
      // lock is one platform's hash and is not committed.
      console.log(`${stack}: no committed lock file, nothing to refresh`);
      continue;
    }
    const changes = staleLockEntries(await lock.text(), pins);
    if (changes.length > 0) stale.set(stack, changes);
  }
  for (const [stack, changes] of stale) {
    for (const change of changes)
      console.log(
        `${stack}: ${change.address} ${change.locked} -> ${change.pinned}`,
      );
  }
  if (check) {
    if (stale.size > 0) {
      console.error(
        "Lock files differ from src/tofu/provider-versions.json.\nRun: bun run --cwd packages/homelab-cdktn providers:refresh",
      );
      process.exit(1);
    }
    console.log("lock files match the provider pins");
    return;
  }
  for (const stack of stale.keys()) await refreshLock(stack, pins);
  await runPackageScript("generate");
  await runPackageScript("synth");
  console.log(
    `refreshed ${stale.size.toString()} lock file(s), the provider bindings and every synthesized stack`,
  );
}

if (import.meta.main) await main();
