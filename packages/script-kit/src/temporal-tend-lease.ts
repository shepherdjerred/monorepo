import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { env } from "node:process";
import { z } from "zod";

const DEFAULT_TEMPORAL_LEASE_TTL_MS = 30 * 60 * 1000;

export const TemporalTendLeaseSchema = z.strictObject({
  version: z.literal(1),
  id: z.string().min(1),
  kind: z.literal("temporal"),
  target: z.string().min(1),
  ownerPid: z.number().int().positive(),
  processStart: z.string().min(1),
  createdAt: z.string().min(1),
  expiresAt: z.string().min(1),
});
export type TemporalTendLease = z.infer<typeof TemporalTendLeaseSchema>;

export type TemporalTendLeaseHandle = {
  readonly id: string;
  readonly leasePath: string;
  readonly record: TemporalTendLease;
  readonly release: () => Promise<void>;
};

let cachedOwnProcessStart: string | undefined;

function currentProcessStart(): string {
  if (cachedOwnProcessStart !== undefined) {
    return cachedOwnProcessStart;
  }
  const output = execFileSync(
    "ps",
    ["-o", "lstart=", "-p", String(process.pid)],
    {
      env: { ...env, TZ: "UTC", LC_ALL: "C" },
      encoding: "utf8",
    },
  ).trim();
  if (output.length === 0) {
    throw new Error(
      `Cannot read process start time via ps -o lstart= -p ${String(process.pid)}`,
    );
  }
  cachedOwnProcessStart = output;
  return output;
}

function resolveTendLeasesDir(explicitTendDir?: string): string {
  const configured = explicitTendDir ?? env["TOOLKIT_TEND_DIR"];
  const root =
    configured !== undefined && configured.length > 0
      ? configured
      : path.join(os.homedir(), ".toolkit", "tend");
  return path.join(root, "leases");
}

export async function acquireTemporalTendLease(
  target: string,
  options: { ttlMs?: number; tendDir?: string; nowMs?: number } = {},
): Promise<TemporalTendLeaseHandle> {
  const leasesDir = resolveTendLeasesDir(options.tendDir);
  await mkdir(leasesDir, { recursive: true, mode: 0o700 });

  const nowMs = options.nowMs ?? Date.now();
  const ttlMs = options.ttlMs ?? DEFAULT_TEMPORAL_LEASE_TTL_MS;
  const id = `temporal-${String(process.pid)}-${randomUUID()}`;
  const record: TemporalTendLease = TemporalTendLeaseSchema.parse({
    version: 1,
    id,
    kind: "temporal",
    target,
    ownerPid: process.pid,
    processStart: currentProcessStart(),
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
  });

  const leasePath = path.join(leasesDir, `${id}.json`);
  const temporaryPath = path.join(leasesDir, `.${id}.tmp`);
  try {
    await writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporaryPath, leasePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }

  let released = false;
  const onExit = (): void => {
    if (released) {
      return;
    }
    released = true;
    spawnSync("rm", ["-f", "--", leasePath], { stdio: "ignore" });
  };
  process.once("exit", onExit);

  let releasePromise: Promise<void> | undefined;
  const release = (): Promise<void> => {
    releasePromise ??= (async () => {
      released = true;
      process.removeListener("exit", onExit);
      await rm(leasePath, { force: true });
    })();
    return releasePromise;
  };

  return { id, leasePath, record, release };
}
