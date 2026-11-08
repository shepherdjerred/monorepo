import { afterEach, expect, test } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { grantTestRequesterAccess } from "#testing/authority.ts";
import { sharedTvFileFixture } from "#automation/native-archive/fixtures/shared-tv.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { prepareBoundRetention } from "#automation/retention/lifecycle.test-fixture.ts";
import { preparePhysicalPublication } from "#automation/plex-binding/test-fixture.ts";
import { PrismaMediaCommands } from "#infrastructure/commands.ts";
import { observeRequesterWatch } from "#automation/watch.ts";
import { CommittedQuarantinePlexReceiptSchema } from "#shared/plex-binding/watch.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { z } from "zod";
import {
  captureWatchReset,
  assertWatchResetAndNewWarning,
} from "./watch-reset.test-support.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

test.each([true, false])(
  "shared-file quarantine requires every co-requester watched=%s and preserves complete coverage",
  async (watched) => {
    const db = harness.database();
    const files = await sharedTvFileFixture(db, mappedPublicationFixture);
    directories.push(files.directory);
    const second = await db.mediaUser.create({
      data: {
        plexAccountId: crypto.randomUUID(),
        displayName: "Second requester",
        role: "member",
      },
    });
    await grantTestRequesterAccess(db, second.id, "fixture-server");
    await new PrismaMediaCommands(db, {
      keepDays: 30,
      serverMachineId: "fixture-server",
    }).createRequest({ ...second, role: "member" }, crypto.randomUUID(), {
      mediaId: files.media.id,
      includeSpecials: false,
      subtitleLanguages: [],
    });
    const published = await preparePhysicalPublication(files);
    const bound = await prepareBoundRetention(
      files,
      published,
      harness.context(),
    );
    const ids = [...published.entry.mediaIds].sort();
    expect(ids).toHaveLength(2);
    const primary = bound.history.find((value) =>
      value.value.events.some((event) => event.mediaId === files.media.id),
    );
    if (primary === undefined)
      throw new Error("Complete shared warning omitted requested leaf");
    expect(primary.value.deliveries.map((row) => row.userId).sort()).toEqual(
      [files.user.id, second.id].sort(),
    );
    expect(primary.value.attempts).toHaveLength(2);
    const originalRequests = await db.mediaRequest.findMany({
      where: { mediaId: { in: ids } },
      orderBy: { id: "asc" },
    });
    const coverage = await db.assetCoverage.findMany({
      where: { assetId: published.entry.assetId },
      orderBy: { mediaId: "asc" },
    });
    if (watched) {
      expect(await bound.quarantine()).toEqual({ status: "quarantined" });
      const operation = await db.operation.findUniqueOrThrow({
        where: { id: bound.operation.id },
      });
      const receipt = CommittedQuarantinePlexReceiptSchema.parse(
        z.object({ quarantinePlexReceipt: z.json() }).parse(operation.result)
          .quarantinePlexReceipt,
      );
      expect(receipt.groups).toHaveLength(1);
      expect(
        receipt.groups[0]?.coverage.map((scope) => scope.mediaId).sort(),
      ).toEqual(ids);
      expect(
        receipt.decisions.map((decision) => decision.mediaId).sort(),
      ).toEqual(ids);
      expect(
        receipt.bindings.map((binding) => binding.scope.mediaId).sort(),
      ).toEqual(ids);
      expect(
        await db.libraryAsset.findUniqueOrThrow({
          where: { id: bound.asset.id },
        }),
      ).toMatchObject({ state: "quarantined" });
    } else {
      const before = await captureWatchReset(bound);
      // Only the synthetic second requester's actual metadata response becomes unwatched.
      const userPlex = bound.context.userPlex;
      bound.context.userPlex = (token) => {
        const client = userPlex(token);
        if (token === `synthetic-requester:${second.id}`) {
          const metadata = client.metadata.bind(client);
          client.metadata = async (...args) => ({
            ...(await metadata(...args)),
            viewCount: 0,
          });
        }
        return client;
      };
      expect(
        await observeRequesterWatch(bound.context, files.media.id),
      ).toEqual({ complete: true, reason: null });
      expect(await bound.refresh()).toEqual({
        status: "obsolete",
        decisionId: null,
        wakeAt: null,
        reason: "intent_obsolete",
      });
      expect(await bound.quarantine()).toMatchObject({ status: "protected" });
      expect(
        await readFile(workerFilePath(files.context, bound.asset.path), "utf8"),
      ).toBe(published.content);
      expect(
        await db.libraryAsset.findUniqueOrThrow({
          where: { id: bound.asset.id },
        }),
      ).toEqual(bound.asset);
      const operation = await db.operation.findUniqueOrThrow({
        where: { id: bound.operation.id },
      });
      expect(operation.result).toBeNull();
      bound.context.userPlex = userPlex;
      await assertWatchResetAndNewWarning(bound, before);
    }
    expect(
      await db.mediaRequest.findMany({
        where: { mediaId: { in: ids } },
        orderBy: { id: "asc" },
      }),
    ).toEqual(originalRequests);
    expect(
      await db.assetCoverage.findMany({
        where: { assetId: published.entry.assetId },
        orderBy: { mediaId: "asc" },
      }),
    ).toEqual(coverage);
  },
);
