import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  ChallengeContractV1Schema,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import { publishChallengeDraft } from "#src/progression/challenges/catalog.ts";
import { previewChallengeDraft } from "#src/progression/challenges/drafts.ts";
import {
  challengeMatchNeedsTimeline,
  challengeRunIdsForMatch,
} from "#src/progression/challenges/postmatch.ts";
import {
  changeChallengeRunAccounts,
  getChallengeRun,
  startChallengeRun,
} from "#src/progression/challenges/run-store.ts";
import {
  createTestDatabase,
  dropTestDatabase,
} from "#src/testing/test-database.ts";
import {
  testAccountId,
  testGuildId,
  testPuuid,
} from "#src/testing/test-ids.ts";

const { prisma: db, dbPath } = createTestDatabase("challenge-persistence");
const OWNER_ID = testAccountId("721");
const GUILD_ID = testGuildId("721");

function challengeContract(title: string) {
  return ChallengeContractV1Schema.parse({
    version: 1,
    evaluatorVersion: "challenge-evaluator-1",
    title,
    summary: `${title} summary`,
    explanation: ["Count completed wins."],
    matchPredicate: { kind: "result", result: "win" },
    progressGoal: { kind: "count", target: 2 },
  });
}

async function createDraft(
  ownerDiscordId: DiscordAccountId,
  title: string,
  sourceTemplateId?: string,
) {
  return await db.challengeDraft.create({
    data: {
      ownerDiscordId,
      ...(sourceTemplateId === undefined ? {} : { sourceTemplateId }),
      contractJson: JSON.stringify(challengeContract(title)),
      previewJson: JSON.stringify({ previewed: true }),
      previewedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
}

async function createOwnedAccounts() {
  const player = await db.player.create({
    data: {
      alias: "Challenge Player",
      discordId: OWNER_ID,
      serverId: GUILD_ID,
      creatorDiscordId: OWNER_ID,
      createdTime: new Date(),
      updatedTime: new Date(),
      accounts: {
        create: [
          {
            alias: "Main",
            puuid: testPuuid("challenge-main"),
            region: "AMERICA_NORTH",
            serverId: GUILD_ID,
            creatorDiscordId: OWNER_ID,
            createdTime: new Date(),
            updatedTime: new Date(),
          },
          {
            alias: "Alt",
            puuid: testPuuid("challenge-alt"),
            region: "AMERICA_NORTH",
            serverId: GUILD_ID,
            creatorDiscordId: OWNER_ID,
            createdTime: new Date(),
            updatedTime: new Date(),
          },
        ],
      },
    },
    include: { accounts: { orderBy: { id: "asc" } } },
  });
  const first = player.accounts[0];
  const second = player.accounts[1];
  if (first === undefined || second === undefined) {
    throw new Error("Challenge fixture requires two accounts");
  }
  return { first, second };
}

async function verifyCompletedRunCannotDisplaceRestart(): Promise<void> {
  const draft = await createDraft(OWNER_ID, "Completed run");
  const template = await publishChallengeDraft(db, {
    ownerDiscordId: OWNER_ID,
    draftId: draft.id,
  });
  const { first, second } = await createOwnedAccounts();
  const completed = await startChallengeRun(db, {
    ownerDiscordId: OWNER_ID,
    templateId: template.templateId,
    accountIds: [first.id],
    mode: { kind: "clean_slate" },
    stage: "beta",
  });
  await db.challengeRun.update({
    where: { id: completed.runId },
    data: { runState: "completed", recomputing: false },
  });
  await db.challengeActiveRun.deleteMany({ where: { runId: completed.runId } });
  const restarted = await startChallengeRun(db, {
    ownerDiscordId: OWNER_ID,
    templateId: template.templateId,
    accountIds: [first.id],
    mode: { kind: "clean_slate" },
    stage: "beta",
  });

  await expect(
    changeChallengeRunAccounts(db, {
      ownerDiscordId: OWNER_ID,
      runId: completed.runId,
      accountIds: [second.id],
      stage: "beta",
    }),
  ).rejects.toThrow("Archived challenge runs cannot be changed");
  expect(
    await db.challengeRun.findUniqueOrThrow({ where: { id: completed.runId } }),
  ).toMatchObject({ runState: "archived" });
  expect(
    await db.challengeActiveRun.findUniqueOrThrow({
      where: {
        ownerDiscordId_templateId: {
          ownerDiscordId: OWNER_ID,
          templateId: template.templateId,
        },
      },
    }),
  ).toMatchObject({ runId: restarted.runId });
}

beforeEach(async () => {
  await db.challengeActiveRun.deleteMany();
  await db.challengeRun.deleteMany();
  await db.challengeDraft.deleteMany();
  await db.challengeTemplateVersion.deleteMany();
  await db.challengeTemplate.deleteMany();
  await db.account.deleteMany();
  await db.player.deleteMany();
  await db.user.deleteMany();
  await db.user.create({
    data: { discordId: OWNER_ID, discordUsername: "challenge-owner" },
  });
});

afterAll(async () => {
  await dropTestDatabase(db, dbPath);
});

describe("challenge persistence", () => {
  test("does not let a completed historical run displace its restart", async () => {
    await verifyCompletedRunCannotDisplaceRestart();
  });

  test("rejects a duplicate account in a challenge preview", async () => {
    const draft = await createDraft(OWNER_ID, "Preview challenge");
    const { first } = await createOwnedAccounts();

    await expect(
      previewChallengeDraft(db, {
        ownerDiscordId: OWNER_ID,
        draftId: draft.id,
        accountIds: [first.id, first.id],
        startAt: new Date(0),
        endAt: new Date(),
      }),
    ).rejects.toThrow("cannot select an account twice");
  });

  test("publishes one version for concurrent confirmation retries", async () => {
    const draft = await createDraft(OWNER_ID, "Concurrent challenge");
    const published = await Promise.all(
      [1, 2].map(
        async () =>
          await publishChallengeDraft(db, {
            ownerDiscordId: OWNER_ID,
            draftId: draft.id,
          }),
      ),
    );

    expect(published[0]?.id).toBe(published[1]?.id);
    expect(await db.challengeTemplate.count()).toBe(1);
    expect(await db.challengeTemplateVersion.count()).toBe(1);
  });

  test("serializes concurrent edits into immutable template versions", async () => {
    const originalDraft = await createDraft(OWNER_ID, "Original");
    const original = await publishChallengeDraft(db, {
      ownerDiscordId: OWNER_ID,
      draftId: originalDraft.id,
    });
    const [firstDraft, secondDraft] = await Promise.all([
      createDraft(OWNER_ID, "First edit", original.templateId),
      createDraft(OWNER_ID, "Second edit", original.templateId),
    ]);

    const edits = await Promise.all([
      publishChallengeDraft(db, {
        ownerDiscordId: OWNER_ID,
        draftId: firstDraft.id,
      }),
      publishChallengeDraft(db, {
        ownerDiscordId: OWNER_ID,
        draftId: secondDraft.id,
      }),
    ]);

    expect(
      edits
        .map((version) => version.version)
        .toSorted((left, right) => left - right),
    ).toEqual([2, 3]);
    expect(
      await db.challengeTemplateVersion.findMany({
        where: { templateId: original.templateId },
        orderBy: { version: "asc" },
        select: { version: true, title: true },
      }),
    ).toEqual([
      { version: 1, title: "Original" },
      { version: 2, title: expect.stringMatching(/edit/u) },
      { version: 3, title: expect.stringMatching(/edit/u) },
    ]);
  });

  test("archives a prior run and keeps its last snapshot during recompute", async () => {
    const draft = await createDraft(OWNER_ID, "Two wins");
    const template = await publishChallengeDraft(db, {
      ownerDiscordId: OWNER_ID,
      draftId: draft.id,
    });
    const { first, second } = await createOwnedAccounts();
    const oldRun = await startChallengeRun(db, {
      ownerDiscordId: OWNER_ID,
      templateId: template.templateId,
      accountIds: [first.id],
      mode: { kind: "clean_slate" },
      stage: "beta",
    });
    const restarted = await startChallengeRun(db, {
      ownerDiscordId: OWNER_ID,
      templateId: template.templateId,
      accountIds: [first.id],
      mode: { kind: "clean_slate" },
      stage: "beta",
    });
    expect(
      await db.challengeRun.findUniqueOrThrow({ where: { id: oldRun.runId } }),
    ).toMatchObject({ runState: "archived", recomputing: false });

    const snapshot = await db.challengeRunSnapshot.create({
      data: {
        runId: restarted.runId,
        revision: 1,
        progressJson: JSON.stringify({
          kind: "scalar",
          reducer: "count",
          current: 1,
          target: 2,
          completed: false,
        }),
        coverageJson: JSON.stringify({
          evaluatedMatchCount: 1,
          selectedPeriod: {
            startAt: new Date(0).toISOString(),
            endAt: null,
          },
          missingTimelineEvidence: 0,
        }),
      },
    });
    await db.challengeRun.update({
      where: { id: restarted.runId },
      data: { currentSnapshotId: snapshot.id, recomputing: false },
    });

    const changed = await changeChallengeRunAccounts(db, {
      ownerDiscordId: OWNER_ID,
      runId: restarted.runId,
      accountIds: [first.id, second.id],
      stage: "beta",
    });
    const visible = await getChallengeRun(db, restarted.runId);

    expect(changed.revision).toBe(2);
    expect(visible.recomputing).toBe(true);
    expect(visible.currentSnapshot).toMatchObject({
      revision: 1,
      progress: { current: 1, target: 2 },
    });
    expect(visible.revisions[0]).toMatchObject({
      revision: 2,
      state: "queued",
    });
  });
});

describe("challenge timeline durability", () => {
  test("detects an initializing timeline-dependent run before cursors exist", async () => {
    const draft = await createDraft(OWNER_ID, "Timeline challenge");
    const template = await publishChallengeDraft(db, {
      ownerDiscordId: OWNER_ID,
      draftId: draft.id,
    });
    const { first, second } = await createOwnedAccounts();
    const run = await startChallengeRun(db, {
      ownerDiscordId: OWNER_ID,
      templateId: template.templateId,
      accountIds: [first.id],
      mode: { kind: "clean_slate" },
      stage: "beta",
    });
    const timelineContract = ChallengeContractV1Schema.parse({
      ...challengeContract("Timeline challenge"),
      matchPredicate: {
        kind: "timeline_event_count",
        eventType: "CHAMPION_KILL",
        operator: "gte",
        threshold: 1,
      },
    });
    await db.challengeRun.update({
      where: { id: run.runId },
      data: { frozenContractJson: JSON.stringify(timelineContract) },
    });

    expect(await db.challengeRunCursor.count()).toBe(0);
    await expect(challengeRunIdsForMatch([first.puuid], db)).resolves.toEqual(
      new Set([run.runId]),
    );
    await expect(challengeRunIdsForMatch([second.puuid], db)).resolves.toEqual(
      new Set(),
    );
    await expect(challengeMatchNeedsTimeline([first.puuid], db)).resolves.toBe(
      true,
    );
    await expect(challengeMatchNeedsTimeline([second.puuid], db)).resolves.toBe(
      false,
    );
  });
});
