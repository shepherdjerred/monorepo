import { afterEach, beforeAll, expect, test } from "vitest";
import { access, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { automationTestHarness } from "#testing/automation.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { sharedTvFileFixture } from "#automation/native-archive/fixtures/shared-tv.ts";
import { seedFixtureReleasedEpisodes } from "#testing/retention-interest.ts";
import { preparePhysicalPublication } from "#automation/plex-binding/test-fixture.ts";
import { prepareBoundRetention } from "#automation/retention/lifecycle.test-fixture.ts";
import { elapsedQuarantineClient } from "#automation/files/plex-binding/elapsed-quarantine.test-support.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { RemovalPlanSchema } from "#automation/files/types.ts";
import { createMovieRetentionFixture } from "#testing/movie-workflow/retention-fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { quarantineMovieFilesV4 } from "#automation/movie-editions/retention/quarantine.ts";
import { observeRequesterWatch } from "#automation/watch.ts";
import { RequestInterestCommands } from "./commands.ts";
import { MediaRequestCommands } from "#infrastructure/request-commands.ts";
import { householdRetentionState } from "./protection.ts";
import type { InitialInterestScenario } from "./quarantine-release.test-fixture.ts";

const h = automationTestHarness();
const closers: (() => Promise<void>)[] = [];
let bytes: Uint8Array;
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function ordinary(scenario: InitialInterestScenario, shared = false) {
  const db = h.database();
  const files = shared
    ? await sharedTvFileFixture(db, mappedPublicationFixture)
    : await mappedPublicationFixture(db);
  closers.push(() => rm(files.directory, { recursive: true, force: true }));
  if (shared) await seedFixtureReleasedEpisodes(db, files.user.id);
  const f = await prepareBoundRetention(
    files,
    await preparePhysicalPublication(files),
    h.context(),
    scenario,
  );
  const timing = await elapsedQuarantineClient(db, {
    ...f.retention.input,
    mediaIds: f.published.entry.mediaIds,
  });
  files.context.db = timing.db;
  expect(await f.quarantine()).toEqual({ status: "quarantined" });
  await timing.assertCommitted();
  files.context.db = db;
  const decision = await db.retentionDecision.findUniqueOrThrow({
    where: { id: f.retention.input.decisionId },
  });
  if (decision.quarantinedAt === null || decision.purgeAfter === null)
    throw new Error("Actual quarantine omitted its original deadline");
  expect(decision.purgeAfter.getTime() - decision.quarantinedAt.getTime()).toBe(
    7 * 86_400_000,
  );
  const entry = RemovalPlanSchema.parse(decision.manifest).assets[0];
  if (entry === undefined)
    throw new Error("Actual quarantine omitted its physical manifest");
  const location = path.join(
    files.context.roots[entry.libraryKind].control,
    "quarantine",
    entry.quarantineId,
  );
  return { ...f, originalDecision: decision, location };
}

async function assertStableFalse(f: Awaited<ReturnType<typeof ordinary>>) {
  const db = h.database();
  const ids = f.published.entry.mediaIds;
  const requests = await db.mediaRequest.findMany({
    where: { mediaId: { in: ids } },
    orderBy: { id: "asc" },
  });
  const targets = await db.mediaIntent.findMany({
    where: { mediaId: { in: ids }, edition: "default" },
    orderBy: { mediaId: "asc" },
  });
  const restores = await db.operation.findMany({
    where: {
      kind: {
        in: [
          "restore_media",
          "restore_native_quarantine",
          "restore_movie_edition_v4",
        ],
      },
      targetId: { in: ids },
    },
    orderBy: { id: "asc" },
  });
  for (let read = 0; read < 2; read++)
    expect(await f.observe(false)).toEqual(
      ids.map(() => ({ complete: true, reason: null })),
    );
  expect(
    await db.mediaRequest.findMany({
      where: { mediaId: { in: ids } },
      orderBy: { id: "asc" },
    }),
  ).toEqual(requests);
  expect(
    await db.mediaIntent.findMany({
      where: { mediaId: { in: ids }, edition: "default" },
      orderBy: { mediaId: "asc" },
    }),
  ).toEqual(targets);
  expect(
    await db.operation.findMany({
      where: {
        kind: {
          in: [
            "restore_media",
            "restore_native_quarantine",
            "restore_movie_edition_v4",
          ],
        },
        targetId: { in: ids },
      },
      orderBy: { id: "asc" },
    }),
  ).toEqual(restores);
  expect(
    await db.retentionDecision.findUniqueOrThrow({
      where: { id: f.originalDecision.id },
    }),
  ).toMatchObject({
    state: "quarantined",
    quarantinedAt: f.originalDecision.quarantinedAt,
    purgeAfter: f.originalDecision.purgeAfter,
  });
  expect(await readFile(f.location, "utf8")).toBe(f.published.content);
  expect(await f.refresh()).toMatchObject({
    status: "purge",
    decisionId: f.originalDecision.id,
  });
}

test.each([
  "lost_interest",
  "finished_manually",
  "dropped_manually",
  "owner_temporary",
] as const)(
  "ordinary %s false remains observational and permits physical purge at the original seven-day deadline",
  async (scenario) => {
    const f = await ordinary(scenario);
    await assertStableFalse(f);
    expect(
      await createMediaFileActivities(f.files.context).purgeMediaFiles(
        f.retention.input,
      ),
    ).toEqual({ status: "purged" });
    await expect(access(f.location)).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      await h.database().retentionDecision.findUniqueOrThrow({
        where: { id: f.originalDecision.id },
      }),
    ).toMatchObject({
      state: "purged",
      quarantinedAt: f.originalDecision.quarantinedAt,
      purgeAfter: f.originalDecision.purgeAfter,
    });
    if (scenario === "owner_temporary")
      expect(
        await h.database().mediaRequest.count({
          where: {
            mediaId: f.files.media.id,
            active: true,
            direct: true,
            excluded: false,
          },
        }),
      ).toBe(0);
  },
  60_000,
);

test.each(["lost_interest", "finished_manually", "dropped_manually"] as const)(
  "named %s false settles without reviving the claim or creating a restore",
  async (scenario) => {
    const f = await createMovieRetentionFixture(
      "directors_cut",
      bytes,
      true,
      scenario,
    );
    closers.push(f.close);
    expect(await f.warning()).toMatchObject({ status: "warning" });
    await f.deliverWarning();
    const due = await f.evaluate();
    if (
      due.status !== "quarantine" ||
      due.decisionId === null ||
      f.context.now === undefined
    )
      throw new Error("Native named quarantine prerequisite failed");
    const execution = testPublicationExecution();
    await quarantineMovieFilesV4(
      {
        ...f.source.files.context,
        now: f.context.now,
        publicationExecution: () => execution,
        movieManagement: {
          execution,
          budget: new PublicationAuthorityReadBudget(),
        },
      },
      {
        schemaVersion: 4,
        operationId: f.input.operationId,
        decisionId: due.decisionId,
        scope: f.scope,
      },
    );
    const before = {
      request: await f.db.mediaRequest.findMany({
        where: { mediaId: f.scope.mediaId, edition: f.scope.edition },
      }),
      target: await f.db.mediaIntent.findUniqueOrThrow({
        where: {
          mediaId_edition: {
            mediaId: f.scope.mediaId,
            edition: f.scope.edition,
          },
        },
      }),
      decision: await f.db.retentionDecision.findUniqueOrThrow({
        where: { id: due.decisionId },
      }),
      parent: await f.db.operation.findUniqueOrThrow({
        where: { id: f.input.operationId },
      }),
    };
    const networkExecution = testPlexBindingExecution();
    expect(
      await observeRequesterWatch(
        {
          ...f.context,
          now: () => new Date(),
          plexBindingExecution: () => networkExecution,
          movieManagement: {
            execution: networkExecution,
            budget: new PublicationAuthorityReadBudget(),
          },
        },
        f.scope.mediaId,
        { edition: f.scope.edition },
      ),
    ).toEqual({ complete: true, reason: null });
    expect(
      await f.db.mediaRequest.findMany({
        where: { mediaId: f.scope.mediaId, edition: f.scope.edition },
      }),
    ).toEqual(before.request);
    expect(
      await f.db.mediaIntent.findUniqueOrThrow({
        where: {
          mediaId_edition: {
            mediaId: f.scope.mediaId,
            edition: f.scope.edition,
          },
        },
      }),
    ).toEqual(before.target);
    expect(
      await f.db.retentionDecision.findUniqueOrThrow({
        where: { id: due.decisionId },
      }),
    ).toEqual(before.decision);
    expect(
      await f.db.operation.findUniqueOrThrow({
        where: { id: f.input.operationId },
      }),
    ).toEqual(before.parent);
    expect(
      await f.db.operation.count({
        where: {
          targetId: f.scope.mediaId,
          kind: {
            in: [
              "restore_media",
              "restore_native_quarantine",
              "restore_movie_edition_v4",
            ],
          },
        },
      }),
    ).toBe(0);
  },
  60_000,
);

test.each(["following", "keep"] as const)(
  "a %s on the other leaf protects the whole actual shared-file cohort from purge",
  async (mode) => {
    const f = await ordinary("lost_interest", true);
    await assertStableFalse(f);
    const db = h.database();
    const sibling = f.published.entry.mediaIds.find(
      (id) => id !== f.files.media.id,
    );
    if (sibling === undefined)
      throw new Error("Shared fixture requires another physical leaf");
    if (mode === "keep") {
      const owner = await db.mediaUser.findFirstOrThrow({
        where: { role: "owner", restricted: false },
      });
      const media = await db.mediaItem.findUniqueOrThrow({
        where: { id: sibling },
      });
      const target = await db.mediaIntent.findUniqueOrThrow({
        where: { mediaId_edition: { mediaId: sibling, edition: "default" } },
      });
      await new RequestInterestCommands(db, { keepDays: 30 }).libraryPolicy(
        owner,
        crypto.randomUUID(),
        {
          schemaVersion: 1,
          mediaId: sibling,
          edition: "default",
          expectedMediaVersion: media.version,
          expectedTargetVersion: target.version,
          keepingPolicy: "keep",
        },
      );
    } else {
      const user = await db.mediaUser.create({
        data: {
          plexAccountId: crypto.randomUUID(),
          displayName: "Interested shared-file viewer",
        },
      });
      const mapping = await db.plexIdentityMapping.findUniqueOrThrow({
        where: { userId: f.files.user.id },
      });
      await db.plexIdentityMapping.create({
        data: {
          ...mapping,
          userId: user.id,
          serverAccountId: user.plexAccountId,
          homeUserId: null,
        },
      });
      await new MediaRequestCommands(db, {
        keepDays: 30,
        serverMachineId: mapping.serverMachineId,
      }).createRequest(user, crypto.randomUUID(), {
        mediaId: sibling,
        keepingPolicy: "temporary",
        subtitleLanguages: [],
        includeSpecials: false,
      });
    }
    expect(
      await db.$transaction((tx) => householdRetentionState(tx, sibling)),
    ).toMatchObject({
      reason:
        mode === "keep"
          ? "library_kept_indefinitely"
          : "requester_still_following",
    });
    expect(
      await createMediaFileActivities(f.files.context).purgeMediaFiles(
        f.retention.input,
      ),
    ).toMatchObject({ status: "protected" });
    expect(await readFile(f.location, "utf8")).toBe(f.published.content);
    expect(
      await db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
    ).toMatchObject({ state: "quarantined" });
  },
  60_000,
);
