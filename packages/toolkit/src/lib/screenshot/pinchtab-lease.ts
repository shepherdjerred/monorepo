/**
 * Lightweight PinchTab lease tracking for `toolkit screenshot`.
 *
 * Writes `${TOOLKIT_TEND_DIR ?? ~/.toolkit/tend}/leases/<id>.json` while a
 * PinchTab session or tab is owned by this process and removes it in `finally`
 * so `toolkit tend` can distinguish live browser resources from orphans.
 */
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import nodePath from "node:path";

export type PinchtabLease = {
  version: 1;
  id: string;
  kind: "pinchtab";
  target: string;
  ownerPid: number;
  processStart: string;
  createdAt: string;
  expiresAt: string;
};

export type PinchtabLeaseHandle = {
  lease: PinchtabLease;
  filePath: string;
  release: () => Promise<void>;
};

const DEFAULT_MIN_LEASE_TTL_MS = 5 * 60_000;

let cachedOwnProcessStart: string | undefined;

function probeProcessStartCommand(pid: number): string | undefined {
  const command =
    process.platform === "win32"
      ? [
          "powershell",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `(Get-Process -Id ${String(pid)}).StartTime.ToUniversalTime().ToString('o')`,
        ]
      : ["ps", "-o", "lstart=", "-p", String(pid)];
  try {
    const result = Bun.spawnSync(command, {
      env: { ...Bun.env, TZ: "UTC", LC_ALL: "C" },
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) {
      return undefined;
    }
    const text = result.stdout.toString().trim();
    return text.length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}

function readProcessStart(pid: number): string {
  if (cachedOwnProcessStart !== undefined && pid === process.pid) {
    return cachedOwnProcessStart;
  }
  const resolved =
    probeProcessStartCommand(pid) ??
    new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString();
  if (pid === process.pid) {
    cachedOwnProcessStart = resolved;
  }
  return resolved;
}

export function resolveTendLeasesDir(): string {
  const tendDir =
    Bun.env["TOOLKIT_TEND_DIR"] ??
    nodePath.join(os.homedir(), ".toolkit", "tend");
  return nodePath.join(tendDir, "leases");
}

export async function createPinchtabLease(
  target: string,
  timeoutMs = 60_000,
): Promise<PinchtabLeaseHandle> {
  const id = randomUUID();
  const now = Date.now();
  const ttlMs = Math.max(timeoutMs * 2, DEFAULT_MIN_LEASE_TTL_MS);
  const lease: PinchtabLease = {
    version: 1,
    id,
    kind: "pinchtab",
    target,
    ownerPid: process.pid,
    processStart: readProcessStart(process.pid),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
  };

  const leasesDir = resolveTendLeasesDir();
  await mkdir(leasesDir, { recursive: true });
  const filePath = nodePath.join(leasesDir, `${id}.json`);
  await writeFile(filePath, `${JSON.stringify(lease, null, 2)}\n`, "utf8");

  let released = false;
  const release = async (): Promise<void> => {
    if (released) {
      return;
    }
    released = true;
    await rm(filePath, { force: true });
  };

  return { lease, filePath, release };
}
