import { expect, test } from "vitest";
import { z } from "zod";
import { DatabaseProviderRegistry } from "#automation/providers.ts";
import { automationTestHarness } from "#testing/automation.ts";
import type { FetchTransport } from "#integrations/http.ts";

const h = automationTestHarness();
const search = { query: "Private synthetic title", kind: "movie" as const };
const html = `<table>${[1, 2, 3]
  .map(
    (id) =>
      `<tr><td class="x-item"><a href="/info/${String(id)}" title="Synthetic ${String(id)}">source</a><div class="tail">Size: 1 GB</div></td></tr>`,
  )
  .join("")}</table>`;
const Header = z.strictObject({
  schemaVersion: z.literal(1),
  providerId: z.literal("magnetdownload"),
  queryHash: z.string(),
  encryptedSnapshot: z.string(),
});
const Snapshot = z.strictObject({
  schemaVersion: z.literal(1),
  results: z.array(z.unknown()),
  hashes: z.array(z.string()),
});

async function fixture(minimumIntervalSeconds: number) {
  const db = h.database();
  await db.reconciliationScan.deleteMany({
    where: { kind: "magnetdownload_search_v1" },
  });
  await db.providerLease.deleteMany({
    where: { providerId: "magnetdownload" },
  });
  await db.mediaProvider.upsert({
    where: { id: "magnetdownload" },
    create: {
      id: "magnetdownload",
      enabled: true,
      configuration: { minimumIntervalSeconds, dailyDownloadLimit: 10 },
    },
    update: {
      enabled: true,
      configuration: { minimumIntervalSeconds, dailyDownloadLimit: 10 },
      lastError: null,
    },
  });
  const calls: string[] = [];
  let rejectHash: string | undefined;
  let leaseChange: "replaced" | "expired" | undefined;
  const transport: FetchTransport = async (url, init) => {
    expect(init.signal?.aborted).toBe(false);
    calls.push(url.pathname + url.search);
    if (leaseChange !== undefined)
      await db.providerLease.update({
        where: { providerId: "magnetdownload" },
        data: {
          ...(leaseChange === "replaced" ? { ownerId: "another-owner" } : {}),
          leaseUntil: new Date(
            Date.now() + (leaseChange === "replaced" ? 300_000 : -1),
          ),
        },
      });
    const id = url.searchParams.get("hashes");
    if (id === rejectHash) return new Response(null, { status: 503 });
    return id === null
      ? new Response(html)
      : Response.json({ hash: id.repeat(40) });
  };
  return {
    db,
    calls,
    transport,
    reject: (id: string | undefined) => {
      rejectHash = id;
    },
    loseLease: (mode: "replaced" | "expired") => {
      leaseChange = mode;
    },
    async elapsed() {
      await db.providerLease.update({
        where: { providerId: "magnetdownload" },
        data: { nextAllowedAt: new Date(Date.now() - 1) },
      });
    },
    run: () =>
      new DatabaseProviderRegistry(db, h.cipher, transport).withProvider(
        "magnetdownload",
        (client) => client.search(search),
      ),
    async checkpoint() {
      const row = await db.reconciliationScan.findFirstOrThrow({
        where: { kind: "magnetdownload_search_v1" },
      });
      const header = Header.parse(row.progress);
      return {
        row,
        snapshot: Snapshot.parse(
          JSON.parse(h.cipher.decrypt(header.encryptedSnapshot, row.id)),
        ),
      };
    },
  };
}

test.each([30, 3600])(
  "configured %is pacing retains actual search and resolved results across new registry instances",
  async (interval) => {
    const f = await fixture(interval);
    await expect(f.run()).rejects.toMatchObject({ kind: "rate-limited" });
    const searched = await f.checkpoint();
    expect(searched.snapshot.hashes).toEqual([]);
    for (const count of [1, 2, 3]) {
      await f.elapsed();
      const candidates = await f.run();
      expect(
        candidates.map((candidate) => candidate.providerReleaseId),
      ).toEqual([1, 2, 3].slice(0, count).map(String));
      const checkpoint = await f.checkpoint();
      expect(checkpoint.row.state).toBe(count === 3 ? "completed" : "running");
      expect(checkpoint.snapshot.hashes).toEqual(
        [1, 2, 3].slice(0, count).map((id) => String(id).repeat(40)),
      );
      expect(checkpoint.row.completedAt === null).toBe(count !== 3);
      expect(JSON.stringify(checkpoint.row.progress)).not.toContain(
        search.query,
      );
      expect(JSON.stringify(checkpoint.row.progress)).not.toContain(
        "Synthetic 1",
      );
      const lease = await f.db.providerLease.findUniqueOrThrow({
        where: { providerId: "magnetdownload" },
      });
      expect(lease.ownerId).toBeNull();
      expect(lease.leaseUntil).toBeNull();
      expect(lease.nextAllowedAt.getTime()).toBeGreaterThan(
        Date.now() + (interval - 1) * 1000,
      );
    }
    expect(f.calls).toEqual([
      "/search/Private%20synthetic%20title/",
      "/api/json_info?hashes=1",
      "/api/json_info?hashes=2",
      "/api/json_info?hashes=3",
    ]);
    // A completed checkpoint never bypasses the provider's original interval.
    await expect(f.run()).rejects.toMatchObject({ kind: "rate-limited" });
    expect(f.calls).toHaveLength(4);
    await f.elapsed();
    await expect(f.run()).rejects.toMatchObject({ kind: "rate-limited" });
    expect(f.calls.filter((path) => path.startsWith("/search/"))).toHaveLength(
      2,
    );
  },
);

test("a failed resolution preserves the retained prefix for another worker", async () => {
  const f = await fixture(30);
  await expect(f.run()).rejects.toMatchObject({ kind: "rate-limited" });
  await f.elapsed();
  expect(await f.run()).toHaveLength(1);
  const before = await f.checkpoint();
  f.reject("2");
  await f.elapsed();
  await expect(f.run()).rejects.toMatchObject({ kind: "unavailable" });
  const failed = await f.checkpoint();
  expect(failed.row).toEqual(before.row);
  f.reject(undefined);
  await f.elapsed();
  expect(await f.run()).toHaveLength(2);
  expect(f.calls.filter((path) => path.endsWith("hashes=1"))).toHaveLength(1);
  expect(f.calls.filter((path) => path.startsWith("/search/"))).toHaveLength(1);
});

test.each(["replaced", "expired"] as const)(
  "a %s lease cannot persist a successful resolution response",
  async (mode) => {
    const f = await fixture(30);
    await expect(f.run()).rejects.toMatchObject({ kind: "rate-limited" });
    const before = await f.checkpoint();
    f.loseLease(mode);
    await f.elapsed();
    await expect(f.run()).rejects.toMatchObject({ kind: "conflict" });
    const stale = await f.checkpoint();
    expect(stale.row).toEqual(before.row);
    expect(
      await f.db.providerLease.findUniqueOrThrow({
        where: { providerId: "magnetdownload" },
      }),
    ).toMatchObject({ ownerId: mode === "replaced" ? "another-owner" : null });
  },
);
