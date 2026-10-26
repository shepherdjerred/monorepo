import { afterEach, expect, test, vi } from "vitest";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { plexBindingFixture } from "./test-fixture.ts";

const harness = automationTestHarness();
const directories: string[] = [];
const authorityResets: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const reset of authorityResets.splice(0)) await reset();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

test.each(["observe", "epoch", "lease"] as const)(
  "ordinary publication refuses refresh after %s changes during the final section lookup",
  async (change) => {
    const db = harness.database();
    const f = await plexBindingFixture(db, harness.context(), {
      publicationPending: true,
    });
    directories.push(f.files.directory);
    const before = await db.mediaItem.findUniqueOrThrow({
      where: { id: f.files.media.id },
    });
    const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.published.attempt.id },
    });
    const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    const lease = await db.legacyWriterLease.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    authorityResets.push(() =>
      db.mediaRuntimeState.update({
        where: { id: runtime.id },
        data: { mode: runtime.mode, recoveryEpoch: runtime.recoveryEpoch },
      }),
    );
    authorityResets.push(() =>
      db.legacyWriterLease.update({
        where: { id: lease.id },
        data: { revokedAt: lease.revokedAt },
      }),
    );
    const sections = f.context.plex.sections.bind(f.context.plex);
    let reached = false;
    vi.spyOn(f.context.plex, "sections").mockImplementationOnce(
      async (signal) => {
        const result = await sections(signal);
        reached = true;
        if (change === "lease") {
          await db.legacyWriterLease.update({
            where: { id: "singleton" },
            data: { revokedAt: new Date() },
          });
        } else {
          await db.mediaRuntimeState.update({
            where: { id: "singleton" },
            data:
              change === "observe"
                ? { mode: "observe" }
                : { recoveryEpoch: { increment: 1 } },
          });
        }
        return result;
      },
    );
    expect(
      await createPublicationActivities(f.context).publishMediaToPlex(
        f.published.input,
      ),
    ).toEqual({ status: "blocked", reason: "ownership_changed" });
    expect(reached).toBe(true);
    expect(f.calls.filter((path) => path.endsWith("/refresh"))).toEqual([]);
    expect(
      await db.mediaItem.findUniqueOrThrow({ where: { id: f.files.media.id } }),
    ).toEqual(before);
    expect(
      await db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
    ).toEqual(f.asset);
    expect(
      await db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      }),
    ).toEqual(attempt);
    expect(
      await db.plexBindingCurrent.count({
        where: { mediaId: f.files.media.id },
      }),
    ).toBe(0);
  },
);
