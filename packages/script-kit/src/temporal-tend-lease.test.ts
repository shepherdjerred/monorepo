import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  acquireTemporalTendLease,
  TemporalTendLeaseSchema,
} from "./temporal-tend-lease.ts";

describe("temporal-tend-lease", () => {
  const scratchDirs: string[] = [];

  afterEach(async () => {
    while (scratchDirs.length > 0) {
      const next = scratchDirs.pop();
      if (next !== undefined) {
        await rm(next, { recursive: true, force: true });
      }
    }
  });

  test("persists a 0600 lease file under leases/ and unlinks on release", async () => {
    const tendRoot = await mkdtemp(path.join(tmpdir(), "tend-root-lease-"));
    scratchDirs.push(tendRoot);

    const handle = await acquireTemporalTendLease("127.0.0.1:49999", {
      tendDir: tendRoot,
      nowMs: Date.UTC(2026, 5, 1, 12, 0, 0),
      ttlMs: 90_000,
    });

    expect(path.dirname(handle.leasePath)).toBe(path.join(tendRoot, "leases"));
    const leaseStat = await stat(handle.leasePath);
    expect(leaseStat.mode & 0o777).toBe(0o600);

    const parsed = TemporalTendLeaseSchema.parse(
      JSON.parse(await readFile(handle.leasePath, "utf8")),
    );
    expect(parsed.id).toBe(handle.id);
    expect(parsed.target).toBe("127.0.0.1:49999");
    expect(parsed.ownerPid).toBe(process.pid);
    expect(parsed.expiresAt).toBe("2026-06-01T12:01:30.000Z");

    await handle.release();
    await handle.release();
    await expect(stat(handle.leasePath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
