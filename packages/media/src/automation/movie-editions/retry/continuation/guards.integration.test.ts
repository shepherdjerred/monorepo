import { expect, test } from "vitest";
import { z } from "zod";
import { createMovieNetworkFacetV4 } from "#automation/movie-editions/activities.ts";
import { MovieLifecycleCommands } from "#infrastructure/movie-editions/lifecycle/commands.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { NativeArchiveScopeProtection } from "#infrastructure/native-archive/errors.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { continuationHarness, attemptInput } from "./support.ts";

const h = continuationHarness();
for (const phase of ["prepared", "imported"] as const) {
  test(`${phase} continuation preserves the caller's spent100-record allowance`, async () => {
    const f = await h.fixture("directors_cut", phase);
    const queued = await f.retry();
    const before = await f.evidence();
    const journals = await f.journalEvidence();
    const execution = testPlexBindingExecution();
    const budget = new PublicationAuthorityReadBudget();
    budget.consume(99);
    expect(
      await createMovieNetworkFacetV4({
        ...f.context,
        movieManagement: { execution, budget },
      }).reconcileMovieIntentV4(queued.input, execution),
    ).toEqual({
      status: "blocked",
      attemptId: null,
      reason: "archive_transition_reconciliation_required",
    });
    expect(() => budget.consume(0)).toThrow(NativeArchiveScopeProtection);
    expect(await f.evidence()).toEqual(before);
    expect(await f.journalEvidence()).toEqual(journals);
  }, 60_000);

  test(`${phase} continuation cannot replace an SDK capability expiring during predecessor observation`, async () => {
    const f = await h.fixture("directors_cut", phase);
    const queued = await f.retry();
    const before = await f.evidence();
    let expired = false;
    f.useDescriptions((id) => {
      expired = true;
      return Promise.resolve({
        status: "FAILED",
        runId: `synthetic-terminal:${id}`,
      });
    });
    const original = testPlexBindingExecution();
    const execution = {
      ...original,
      assertActive: () => {
        original.assertActive();
        if (expired) throw new Error("Original movie continuation SDK expired");
      },
    };
    await expect(
      f.movie.reconcileMovieIntentV4(queued.input, execution),
    ).rejects.toThrow("Original movie continuation SDK expired");
    expect(expired).toBe(true);
    expect(await f.evidence()).toEqual(before);
  }, 60_000);

  test.each([
    "root_running",
    "child_missing",
    "cancel",
    "profile",
    "epoch",
  ] as const)(
    `${phase} continuation protects actual %s changes before renewing its coordinator`,
    async (change) => {
      const f = await h.fixture("final_cut", phase);
      const queued = await f.retry();
      if (change === "root_running")
        f.useDescriptions((id) =>
          Promise.resolve({
            status: "RUNNING",
            runId: `synthetic-active:${id}`,
          }),
        );
      if (change === "child_missing")
        f.useDescriptions((id) =>
          Promise.resolve(
            id.startsWith("media-acquire-")
              ? null
              : { status: "FAILED", runId: `synthetic-closed:${id}` },
          ),
        );
      if (change === "cancel") {
        const request = await f.db.mediaRequest.findFirstOrThrow({
          where: {
            mediaId: f.input.mediaId,
            edition: f.input.scope.edition,
            userId: f.actor.id,
          },
        });
        const target = await f.db.mediaIntent.findUniqueOrThrow({
          where: {
            mediaId_edition: {
              mediaId: f.input.mediaId,
              edition: f.input.scope.edition,
            },
          },
        });
        const sections = await f.context.permittedSections();
        await new MovieLifecycleCommands(f.db, {
          keepDays: 30,
          serverMachineId: z.string().min(1).parse(f.context.serverMachineId),
          movieSectionId: sections.movie,
        }).cancelMovieEditionRequest(f.actor, crypto.randomUUID(), {
          schemaVersion: 3,
          action: "cancel_request",
          scope: f.input.scope,
          subjectUserId: f.actor.id,
          requestId: request.id,
          expected: {
            targetVersion: target.version,
            requestVersion: request.version,
            choiceRevision: request.movieEditionChoiceRevision,
          },
        });
      }
      if (change === "epoch")
        await f.db.mediaRuntimeState.update({
          where: { id: "singleton" },
          data: { recoveryEpoch: { increment: 1 } },
        });
      if (change === "profile") {
        const target = await f.db.mediaIntent.findUniqueOrThrow({
          where: {
            mediaId_edition: {
              mediaId: f.input.mediaId,
              edition: f.input.scope.edition,
            },
          },
        });
        const profile = await f.db.qualityProfile.findUniqueOrThrow({
          where: { id: z.uuid().parse(target.profileId) },
        });
        await f.db.qualityProfile.update({
          where: { id: profile.id },
          data: {
            version: { increment: 1 },
            versions: {
              create: {
                version: profile.version + 1,
                rules: z.record(z.string(), z.json()).parse(profile.rules),
              },
            },
          },
        });
      }
      const before = await f.evidence();
      const journals = await f.journalEvidence();
      const files = await f.fileEvidence();
      expect(
        await f.movie.reconcileMovieIntentV4(
          queued.input,
          testPlexBindingExecution(),
        ),
      ).not.toMatchObject({ status: "acquire" });
      expect(await f.evidence()).toEqual(before);
      expect(await f.journalEvidence()).toEqual(journals);
      expect(await f.fileEvidence()).toEqual(files);
    },
    60_000,
  );
}

test("a pending prepared capture protects when its actual original producer completes physical publication", async () => {
  const f = await h.fixture("theatrical_cut", "prepared");
  const queued = await f.retry();
  expect(
    await f.fileMovie.promoteMovieFilesV4(
      await attemptInput(f, f.input.operationId),
      testPublicationExecution(),
    ),
  ).toEqual({ status: "published" });
  const before = await f.evidence();
  expect(before.attempt?.state).toBe("imported");
  expect(
    await f.movie.reconcileMovieIntentV4(
      queued.input,
      testPlexBindingExecution(),
    ),
  ).not.toMatchObject({ status: "acquire" });
  expect(await f.evidence()).toEqual(before);
}, 60_000);
