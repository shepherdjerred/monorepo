import { afterEach, expect, test } from "vitest";
import { z } from "zod";
import { createMovieWorkflowFixture } from "#testing/movie-workflow/fixture.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { MovieSubtitleOperationV4Schema } from "#shared/movie-editions/subtitles-v4.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import { MovieLifecycleCommands } from "#infrastructure/movie-editions/lifecycle/commands.ts";
import { prepareSubtitleSpeechV1 } from "#automation/files/subtitle-lifecycle/speech.ts";
import { authorizeMovieSubtitleSpeechV4 } from "#automation/files/subtitle-lifecycle/movie-speech-authority.ts";
import {
  acquireMovieFixture,
  publishMovieFixtureFiles,
  finishMovieFixturePublication,
} from "#testing/movie-workflow/upgrade-fixture.ts";

const close: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const end of close.splice(0)) await end();
});

/** Actual consent, transfer, Files publication, Plex publication and provider download. */
async function fixture(edition: MovieEditionKey = "extended_cut") {
  const f = await createMovieWorkflowFixture(edition, { missingEnglish: true });
  close.push(f.close);
  const input = await acquireMovieFixture(f);
  await publishMovieFixtureFiles(f, input);
  await finishMovieFixturePublication(f, input);
  const captions = await f.captionOperations();
  const operation = captions.find(
    (row) =>
      z.object({ language: z.string() }).parse(row.payload).language === "en",
  );
  if (operation === undefined)
    throw new Error("Actual English caption command missing");
  const otherOperation = captions.find((row) => row.id !== operation.id);
  if (otherOperation === undefined)
    throw new Error("Actual sibling caption command missing");
  const target = MovieSubtitleOperationV4Schema.parse(
    z.object(MovieSubtitleOperationV4Schema.shape).parse(operation.payload),
  );
  const found = await f.movie.findMovieSubtitlesV4(
    target,
    testPlexBindingExecution(),
  );
  expect(found.status).toBe("found");
  const subtitle = await f.source.db.subtitleAsset.findUniqueOrThrow({
    where: { id: z.uuid().parse(found.subtitleId) },
  });
  const asset = await f.source.db.libraryAsset.findUniqueOrThrow({
    where: { id: target.assetId },
  });
  const execution = testPublicationExecution();
  const context = { ...f.fileContext, publicationExecution: () => execution };
  return {
    ...f,
    target,
    subtitle,
    asset,
    context,
    execution,
    otherOperationId: otherOperation.id,
  };
}

function authorize(f: Awaited<ReturnType<typeof fixture>>) {
  return authorizeMovieSubtitleSpeechV4(f.context, {
    target: f.target,
    subtitle: f.subtitle,
    asset: f.asset,
    budget: new PublicationAuthorityReadBudget(),
    execution: f.execution,
  });
}

test.each(["default", "extended_cut"] as const)(
  "%s speech measurement retains the original candidate and is idempotent once prepared",
  async (edition) => {
    const f = await fixture(edition);
    const input = {
      operationId: f.target.operationId,
      subtitleId: f.subtitle.id,
    };
    await authorize(f);
    await prepareSubtitleSpeechV1(f.context, input);
    const prepared = await f.source.db.subtitleAsset.findUniqueOrThrow({
      where: { id: f.subtitle.id },
    });
    expect(prepared).toMatchObject({
      state: "validated",
      version: 1,
      path: null,
    });
    expect(prepared.matchingEvidence).toMatchObject({
      movieScope: f.target.scope,
      targetAuthority: f.target.targetAuthority,
      timingAlignedV1: {
        videoChecksum: f.asset.checksum,
        subtitleChecksum: prepared.checksum,
        engine: "ffsubsync-0.5.1",
      },
    });
    await prepareSubtitleSpeechV1(f.context, input);
    expect(
      await f.source.db.subtitleAsset.findUniqueOrThrow({
        where: { id: prepared.id },
      }),
    ).toEqual(prepared);
    expect(
      await f.source.db.libraryAsset.findUniqueOrThrow({
        where: { id: f.asset.id },
      }),
    ).toEqual(f.asset);
  },
  60_000,
);

test.each(["root", "edition", "command", "epoch"] as const)(
  "speech authority rejects the wrong %s without changing its genuine candidate",
  async (change) => {
    const f = await fixture();
    await authorize(f);
    const target = {
      ...f.target,
      ...(change === "command" ? { operationId: f.otherOperationId } : {}),
      ...(change === "epoch"
        ? { recoveryEpoch: f.target.recoveryEpoch + 1 }
        : {}),
      scope: {
        ...f.target.scope,
        ...(change === "root" ? { rootMediaId: crypto.randomUUID() } : {}),
        ...(change === "edition" ? { edition: "directors_cut" as const } : {}),
      },
    };
    await expect(
      authorizeMovieSubtitleSpeechV4(f.context, {
        target,
        subtitle: f.subtitle,
        asset: f.asset,
        budget: new PublicationAuthorityReadBudget(),
        execution: f.execution,
      }),
    ).rejects.toThrow();
    expect(
      await f.source.db.subtitleAsset.findUniqueOrThrow({
        where: { id: f.subtitle.id },
      }),
    ).toEqual(f.subtitle);
  },
  60_000,
);

test("revoking the actual V4 choice protects speech measurement", async () => {
  const f = await fixture();
  await authorize(f);
  const request = await f.source.db.mediaRequest.findUniqueOrThrow({
    where: {
      userId_mediaId_edition: {
        userId: f.source.user.id,
        mediaId: f.target.scope.mediaId,
        edition: f.target.scope.edition,
      },
    },
  });
  const intent = await f.source.db.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: { mediaId: request.mediaId, edition: request.edition },
    },
  });
  await new MovieLifecycleCommands(f.source.db, {
    keepDays: 30,
    serverMachineId: "fixture-server",
    movieSectionId: "1",
  }).revokeMovieEditionChoiceV4(f.source.user, crypto.randomUUID(), {
    schemaVersion: 4,
    action: "revoke_choice",
    scope: f.target.scope,
    subjectUserId: f.source.user.id,
    requestId: request.id,
    expected: {
      targetVersion: intent.version,
      requestVersion: request.version,
      choiceRevision: request.movieEditionChoiceRevision,
    },
  });
  await expect(authorize(f)).rejects.toThrow();
  expect(
    await f.source.db.subtitleAsset.findUniqueOrThrow({
      where: { id: f.subtitle.id },
    }),
  ).toEqual(f.subtitle);
}, 60_000);

test("a stale candidate snapshot cannot authorize a second measurement", async () => {
  const f = await fixture();
  await authorize(f);
  await prepareSubtitleSpeechV1(f.context, {
    operationId: f.target.operationId,
    subtitleId: f.subtitle.id,
  });
  await expect(authorize(f)).rejects.toThrow(
    "subtitle_speech_candidate_changed",
  );
});

test("movie library access changed during measurement cannot commit caption proof", async () => {
  const f = await fixture();
  await authorize(f);
  let changed = false;
  f.context.checkpoint = (phase) => {
    if (phase === "subtitle-speech-measurement") {
      changed = true;
      f.context.permittedMovieSection = () => Promise.resolve("99");
    }
    return Promise.resolve();
  };
  await expect(
    prepareSubtitleSpeechV1(f.context, {
      operationId: f.target.operationId,
      subtitleId: f.subtitle.id,
    }),
  ).rejects.toThrow();
  expect(changed).toBe(true);
  expect(
    await f.source.db.subtitleAsset.findUniqueOrThrow({
      where: { id: f.subtitle.id },
    }),
  ).toEqual(f.subtitle);
});

test("speech measurement preserves an already exhausted read allowance", async () => {
  const f = await fixture();
  const budget = new PublicationAuthorityReadBudget();
  budget.consume(99);
  await expect(
    prepareSubtitleSpeechV1(
      { ...f.context, movieManagement: { execution: f.execution, budget } },
      { operationId: f.target.operationId, subtitleId: f.subtitle.id },
    ),
  ).rejects.toThrow("100 total queried records");
  expect(() => budget.consume(1)).toThrow("100 total queried records");
  expect(
    await f.source.db.subtitleAsset.findUniqueOrThrow({
      where: { id: f.subtitle.id },
    }),
  ).toEqual(f.subtitle);
});
