import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateX25519Identity, identityToRecipient } from "age-encryption";
import { createOpener, createSealer } from "#lib/brim/sync/crypto.ts";
import type { createMemoryObjectStore } from "#lib/brim/sync/object-store.ts";
import {
  defaultBrimSyncPaths,
  type BrimSyncPaths,
} from "#lib/brim/sync/paths.ts";
import type { PushOptions } from "#lib/brim/sync/push.ts";
import { syncRoots } from "#lib/brim/sync/scan.ts";
import { useTempDirectories } from "#test/support/temp-directories.ts";

/** Fake machines, transcripts and keys for brim sync tests. */

export const tempHome = useTempDirectories("brim-sync-");

export type Machine = {
  readonly home: string;
  readonly paths: BrimSyncPaths;
  readonly machineId: string;
};

export async function machine(machineId: string): Promise<Machine> {
  const home = await tempHome();
  return { home, paths: defaultBrimSyncPaths(home), machineId };
}

export async function write(
  home: string,
  relative: string,
  contents: string,
): Promise<string> {
  const file = path.join(home, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents);
  return file;
}

export const CLAUDE_SESSION = ".claude/projects/-Users-me-repo/session-a.jsonl";
export const CODEX_SESSION = ".codex/sessions/2026/11/02/rollout-1.jsonl";

export async function keys() {
  const identity = await generateX25519Identity();
  const recipient = await identityToRecipient(identity);
  return {
    seal: createSealer(recipient),
    open: createOpener(identity),
  };
}

export function pushOptions(
  source: Machine,
  store: ReturnType<typeof createMemoryObjectStore>,
  crypto: Awaited<ReturnType<typeof keys>>,
  overrides: Partial<PushOptions> = {},
): PushOptions {
  return {
    store,
    seal: crypto.seal,
    open: crypto.open,
    paths: source.paths,
    machineId: source.machineId,
    displayName: `${source.machineId}.local`,
    platform: "darwin",
    roots: syncRoots({}, source.home),
    ...overrides,
  };
}

export function mirrored(
  target: Machine,
  from: string,
  relative: string,
): string {
  return path.join(target.paths.mirrorDir, from, relative);
}
