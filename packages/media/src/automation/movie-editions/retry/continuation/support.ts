import { afterEach, beforeAll, expect } from "vitest";
import {
  createMovieContinuationFixture,
  type MovieContinuationPhase,
} from "#testing/movie-workflow/retry-continuation-fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import { z } from "zod";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";

export type Fixture = Awaited<
  ReturnType<typeof createMovieContinuationFixture>
>;
export function continuationHarness() {
  const closers: (() => Promise<void>)[] = [];
  let bytes: Uint8Array;
  let upgrade: Uint8Array;
  let managedUpgrade: Uint8Array;
  beforeAll(async () => {
    bytes = await movieVideoFixture();
    upgrade = await movieVideoFixture(3840);
    managedUpgrade = await movieVideoFixture(3840, undefined, {
      bitrateKbps: 160_000,
    });
  });
  afterEach(async () => {
    for (const close of closers.splice(0)) await close();
  });
  return {
    get bytes() {
      return bytes;
    },
    get upgrade() {
      return upgrade;
    },
    async fixture(
      edition: MovieEditionKey,
      phase: MovieContinuationPhase,
      options: { upgrade?: boolean; managed?: boolean } = {},
    ) {
      const f = await createMovieContinuationFixture(edition, {
        bytes,
        phase,
        ...(options.upgrade === true
          ? {
              upgrade: {
                original: bytes,
                next: options.managed === true ? managedUpgrade : upgrade,
                ...(options.managed === undefined
                  ? {}
                  : { managed: options.managed }),
              },
            }
          : {}),
      });
      closers.push(f.close);
      await f.settleOriginalFailure();
      const evidence = await f.evidence();
      if (evidence.attempt === null)
        throw new Error("Actual continuation omitted its prepared acquisition");
      const attemptId = evidence.attempt.id;
      const coordinatorId = z
        .uuid()
        .parse(evidence.attempt.coordinatorOperationId);
      // This Media boundary test substitutes only Temporal descriptions; role tests use native executions.
      f.useDescriptions((id) => {
        if (
          id !== `media-operation-${coordinatorId}` &&
          id !== `media-acquire-${attemptId}`
        )
          throw new Error("Continuation inspected an unrelated predecessor");
        return Promise.resolve({
          status: "FAILED",
          runId: `synthetic-closed:${id}`,
        });
      });
      return f;
    },
  };
}

export function literalBirth(
  attempt: NonNullable<Awaited<ReturnType<Fixture["evidence"]>>["attempt"]>,
) {
  return {
    id: attempt.id,
    operationId: attempt.operationId,
    edition: attempt.edition,
    releaseId: attempt.releaseId,
    sponsorRequestId: attempt.sponsorRequestId,
    mediaIds: attempt.mediaIds,
    generations: attempt.generations,
    recoveryEpoch: attempt.recoveryEpoch,
    identityEvidence: attempt.identityEvidence,
    movieEditionChoiceId: attempt.movieEditionChoiceId,
    movieEditionChoiceRevision: attempt.movieEditionChoiceRevision,
    movieEditionAuthority: attempt.movieEditionAuthority,
  };
}

export async function attemptInput(f: Fixture, operationId: string) {
  const evidence = await f.evidence();
  if (evidence.attempt === null)
    throw new Error("Actual continuation acquisition disappeared");
  return {
    schemaVersion: 4 as const,
    operationId,
    attemptId: evidence.attempt.id,
    scope: f.input.scope,
  };
}

export async function finishContinuation(
  f: Fixture,
  operationId: string,
  imported = false,
) {
  const input = await attemptInput(f, operationId);
  expect(
    await f.movie.submitMovieTorrentV4(input, testPlexBindingExecution()),
  ).toMatchObject({ status: "submitted" });
  expect(
    await f.movie.observeMovieAcquisitionV4(input, testPlexBindingExecution()),
  ).toMatchObject({ status: "ready" });
  if (!imported) {
    expect(
      await f.fileMovie.inspectAndStageMovieV4(
        input,
        testPublicationExecution(),
      ),
    ).toEqual({ status: "staged" });
    expect(
      await f.fileMovie.promoteMovieFilesV4(input, testPublicationExecution()),
    ).toEqual({ status: "published" });
  }
  expect(
    await f.movie.publishMovieToPlexV4(input, testPlexBindingExecution()),
  ).toEqual({ status: "available", reason: null });
  await f.movie.finalizeMovieAcquisitionV4(input, testPlexBindingExecution());
  return f.evidence();
}
