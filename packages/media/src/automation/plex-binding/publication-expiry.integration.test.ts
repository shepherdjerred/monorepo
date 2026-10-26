import { afterEach, expect, test, vi } from "vitest";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import * as authority from "#infrastructure/plex-binding/authority.ts";
import { plexBindingFixture } from "./test-fixture.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

test("renewing the writer lease during metadata IO cannot extend the consumed publication deadline", async () => {
  const db = harness.database();
  const f = await plexBindingFixture(db, harness.context(), {
    publicationPending: true,
  });
  directories.push(f.files.directory);
  const at = Date.now();
  await db.legacyWriterLease.update({
    where: { id: "singleton" },
    data: { observedAt: new Date(at), expiresAt: new Date(at + 20_000) },
  });
  const before = await db.mediaItem.findUniqueOrThrow({
    where: { id: f.files.media.id },
  });
  const metadata = f.context.plex.metadata.bind(f.context.plex);
  let reached = false;
  vi.spyOn(f.context.plex, "metadata").mockImplementationOnce(
    async (key, signal) => {
      const result = await metadata(key, signal);
      reached = true;
      vi.spyOn(Date, "now").mockReturnValue(at + 20_001);
      await db.legacyWriterLease.update({
        where: { id: "singleton" },
        data: {
          observedAt: new Date(at + 20_001),
          expiresAt: new Date(at + 80_001),
        },
      });
      return result;
    },
  );
  expect(
    await createPublicationActivities(f.context).publishMediaToPlex(
      f.published.input,
    ),
  ).toEqual({ status: "blocked", reason: "verification_expired" });
  expect(reached).toBe(true);
  expect(f.calls.filter((path) => path.endsWith("/refresh"))).toHaveLength(1);
  expect(
    await db.mediaItem.findUniqueOrThrow({ where: { id: f.files.media.id } }),
  ).toEqual(before);
  expect(
    await db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
  ).toEqual(f.asset);
  expect(
    await db.plexBindingCurrent.count({ where: { mediaId: f.files.media.id } }),
  ).toBe(0);
});

test("the final publication transaction retains the original shorter lease in its actual deferred SQL deadline", async () => {
  const db = harness.database();
  const f = await plexBindingFixture(db, harness.context(), {
    publicationPending: true,
  });
  directories.push(f.files.directory);
  const at = Date.now();
  const originalExpiry = at + 20_000;
  await db.legacyWriterLease.update({
    where: { id: "singleton" },
    data: { observedAt: new Date(at), expiresAt: new Date(originalExpiry) },
  });
  const metadata = f.context.plex.metadata.bind(f.context.plex);
  vi.spyOn(f.context.plex, "metadata").mockImplementationOnce(
    async (key, signal) => {
      const result = await metadata(key, signal);
      await db.legacyWriterLease.update({
        where: { id: "singleton" },
        data: { expiresAt: new Date(at + 100_000) },
      });
      return result;
    },
  );
  const lock = authority.lockPlexBindingScope;
  const deadlines: string[] = [];
  vi.spyOn(authority, "lockPlexBindingScope").mockImplementation(
    async (tx, scope, freshness, purpose) => {
      await lock(tx, scope, freshness, purpose);
      const rows = await tx.$queryRaw<
        { deadline: string }[]
      >`SELECT current_setting('media.plex_deadline_ms') AS deadline`;
      const value = rows[0]?.deadline;
      if (value === undefined)
        throw new Error(
          "Actual publication transaction omitted its SQL deadline",
        );
      deadlines.push(value);
    },
  );
  expect(
    await createPublicationActivities(f.context).publishMediaToPlex(
      f.published.input,
    ),
  ).toEqual({ status: "available", reason: null });
  expect(deadlines).toHaveLength(2);
  expect(deadlines[1]).toBe(String(originalExpiry));
  const renewedLease = await db.legacyWriterLease.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  expect(renewedLease.expiresAt.getTime()).toBeGreaterThan(originalExpiry);
});
