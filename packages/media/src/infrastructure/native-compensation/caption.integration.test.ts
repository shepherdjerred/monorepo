import { afterAll, beforeEach, expect, test } from "vitest";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { automationTestHarness } from "#testing/automation.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { PublicationIntentSchema } from "#shared/publication-proof/intent.ts";
import {
  grantNativePredecessor,
  restoreNativeFixtureAgain,
} from "#automation/native-compensation/native-grant-fixture.ts";
import { resolvePublicationTransitionAuthority } from "#infrastructure/publication-proof/authority.ts";
import { compensatedCaptionFixture } from "./caption.test-support.ts";
import { resolveCompensationPhysicalReference } from "./receipts.ts";
import { replaceCompensatedCaption } from "./caption-replacement.test-support.ts";

const harness = automationTestHarness();
const directories: string[] = [];
let fixture: Awaited<ReturnType<typeof compensatedCaptionFixture>> | undefined;
beforeEach(async () => {
  fixture = await compensatedCaptionFixture(
    harness.database(),
    harness.context(),
  );
  directories.push(fixture.f.file.directory);
});
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

test("actual post-compensation caption retains its own install proof through the next video upgrade", async () => {
  if (fixture === undefined) throw new Error("Actual caption setup missing");
  const { f, input, subtitle, completion } = fixture;
  const db = harness.database();
  const reference = await resolveCompensationPhysicalReference(db, {
    continuationId: input.continuationId,
    assetId: f.asset.id,
  });
  expect(
    reference.subtitleLineage?.installations.map((item) => item.subtitleId),
  ).toEqual([subtitle.id]);
  const acquired = await f.file.acquisition(
    "Actual upgrade after new owned caption",
  );
  const activities = createMediaFileActivities(f.file.context);
  expect(await activities.inspectAndStageMedia(acquired.input)).toEqual({
    status: "staged",
  });
  expect(await activities.promoteMediaFiles(acquired.input)).toEqual({
    status: "published",
  });
  const transition = await db.mediaPublicationTransition.findUniqueOrThrow({
    where: { attemptId: acquired.attempt.id },
  });
  const intent = PublicationIntentSchema.parse(transition.intent);
  expect(intent.entries[0]?.originalGrant).toEqual(reference);
  expect(
    intent.entries[0]?.subtitleEvidence?.journals.map(
      (journal) => journal.path,
    ),
  ).toEqual([`journal/${fixture.operation.id}.json`]);
  expect(
    intent.entries[0]?.predecessor?.subtitles.some(
      (item) => item.id === subtitle.id,
    ),
  ).toBe(true);
  const successor = intent.entries[0]?.entry.assetId;
  if (successor === undefined) throw new Error("Actual successor missing");
  await expect(
    resolvePublicationTransitionAuthority(db, {
      transitionId: transition.id,
      assetId: successor,
    }),
  ).resolves.toMatchObject({ originalGrant: reference });
  const continuation =
    await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: input.continuationId },
    });
  expect(continuation.completion).toEqual(completion);
});

test("same-byte installation journal substitution after hashing cannot grant a new publication intent", async () => {
  if (fixture === undefined) throw new Error("Actual caption setup missing");
  const { f, operation } = fixture;
  const db = harness.database();
  const acquired = await f.file.acquisition("Caption journal race successor");
  const activities = createMediaFileActivities(f.file.context);
  expect(await activities.inspectAndStageMedia(acquired.input)).toEqual({
    status: "staged",
  });
  const journal = path.join(
    f.file.roots.control,
    "journal",
    `${operation.id}.json`,
  );
  const bytes = await readFile(journal);
  const original = f.file.context.checkpoint;
  let changed = false;
  f.file.context.checkpoint = async (phase) => {
    await original(phase);
    if (phase !== "content-proof-ready" || changed) return;
    changed = true;
    await writeFile(`${journal}.replacement`, bytes);
    await rename(`${journal}.replacement`, journal);
  };
  try {
    await expect(
      activities.promoteMediaFiles(acquired.input),
    ).rejects.toThrow();
  } finally {
    f.file.context.checkpoint = original;
  }
  expect(changed).toBe(true);
  expect(
    await db.mediaPublicationTransition.count({
      where: { attemptId: acquired.attempt.id },
    }),
  ).toBe(0);
  const currentAsset = await db.libraryAsset.findUniqueOrThrow({
    where: { id: f.asset.id },
  });
  expect(currentAsset.state).toBe("published");
});

test("actual added caption survives native rebaseline and another restore without rewriting completion", async () => {
  if (fixture === undefined) throw new Error("Actual caption setup missing");
  const { f, input, subtitle, completion } = fixture;
  const db = harness.database();
  let setup = await restoreNativeFixtureAgain(db, {
    ...f,
    prior: {
      ...f.prior,
      context: { ...f.prior.context, ...f.observerContext },
    },
  });
  const first = await grantNativePredecessor(db, setup);
  expect(first.recoveryEpoch).toBe(input.recoveryEpoch + 1);
  const currentSubtitle = await db.subtitleAsset.findUniqueOrThrow({
    where: { id: subtitle.id },
  });
  expect(currentSubtitle.ownershipEpoch).toBe(first.recoveryEpoch);
  setup = await restoreNativeFixtureAgain(db, setup);
  const second = await grantNativePredecessor(db, setup);
  expect(second.recoveryEpoch).toBe(first.recoveryEpoch + 1);
  const continuation =
    await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: input.continuationId },
    });
  expect(continuation.completion).toEqual(completion);
});

test("an added caption with changed ownership cannot borrow the compensation receipt", async () => {
  if (fixture === undefined) throw new Error("Actual caption setup missing");
  const { f, input, subtitle } = fixture;
  const db = harness.database();
  await db.subtitleAsset.update({
    where: { id: subtitle.id },
    data: { ownershipEpoch: subtitle.ownershipEpoch - 1 },
  });
  await expect(
    resolveCompensationPhysicalReference(db, {
      continuationId: input.continuationId,
      assetId: f.asset.id,
    }),
  ).rejects.toThrow("installation binding changed");
});

test("compensation does not renew a historical subtitle policy for replacement", async () => {
  if (fixture === undefined) throw new Error("Actual caption setup missing");
  await expect(
    replaceCompensatedCaption(harness.database(), harness.context(), fixture),
  ).rejects.toThrow(
    "Current subtitle policy or media authority requires reconciliation",
  );
});
