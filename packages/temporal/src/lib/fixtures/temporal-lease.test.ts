import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  acquireTemporalTendLease,
  TemporalTendLeaseSchema,
} from "#lib/fixtures/temporal-lease.ts";

describe("acquireTemporalTendLease", () => {
  let directory = "";

  afterEach(async () => {
    if (directory !== "") {
      await rm(directory, { recursive: true, force: true });
      directory = "";
    }
  });

  test("writes a version-1 temporal lease record and removes it on release", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "temporal-tend-lease-"));
    const nowMs = Date.UTC(2026, 10, 15, 22, 0, 0);
    const lease = await acquireTemporalTendLease("127.0.0.1:41234", {
      tendDir: directory,
      nowMs,
      ttlMs: 60_000,
    });

    expect(lease.leasePath).toBe(
      path.join(directory, "leases", `${lease.id}.json`),
    );
    const fileStat = await stat(lease.leasePath);
    expect(fileStat.mode & 0o777).toBe(0o600);

    const persisted = TemporalTendLeaseSchema.parse(
      JSON.parse(await readFile(lease.leasePath, "utf8")),
    );
    expect(persisted).toEqual({
      version: 1,
      id: lease.id,
      kind: "temporal",
      target: "127.0.0.1:41234",
      ownerPid: process.pid,
      processStart: expect.any(String),
      createdAt: "2026-11-15T22:00:00.000Z",
      expiresAt: "2026-11-15T22:01:00.000Z",
    });

    await lease.release();
    await expect(stat(lease.leasePath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    // Idempotent second release.
    await expect(lease.release()).resolves.toBeUndefined();
  });
});
