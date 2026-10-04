import { randomBytes } from "node:crypto";
import type { BridgeClient } from "#bridge/client.ts";

/** How long a sandbox may take from create to a healthy bridge. */
export const BOOT_TIMEOUT_MS = 240_000;

export function newSandboxId(): `sbx-${string}` {
  return `sbx-${randomBytes(3).toString("hex")}`;
}

/** Per-sandbox bridge token and RCON password; they never leave the record. */
export function newSandboxSecrets(): {
  bridgeToken: string;
  rconPassword: string;
} {
  return {
    bridgeToken: randomBytes(24).toString("hex"),
    rconPassword: randomBytes(24).toString("hex"),
  };
}

/** Polls MCBridge /v1/health until it answers or the boot deadline passes. */
export async function waitForBridge(
  client: BridgeClient,
  deadline: number,
): Promise<void> {
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      await client.health();
      return;
    } catch (error) {
      last = error;
      await Bun.sleep(500);
    }
  }
  throw new Error(
    `MCBridge did not answer /v1/health before the boot deadline: ${last instanceof Error ? last.message : String(last)}`,
  );
}
