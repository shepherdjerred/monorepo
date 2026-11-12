import path from "node:path";
import type { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import type { PlexClient } from "#integrations/plex.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { analyzeCutTexts } from "#domain/editions/parse.ts";
import { conventionalMovieCutTexts } from "#domain/editions/parse-v2.ts";
import { movieCutMatches } from "#shared/movie-editions/cut-v2.ts";
import { MOVIE_EDITION_REGISTRY } from "#shared/movie-editions/registry.ts";
import {
  capturePlexEditionSnapshotV1,
  assertPlexEditionReadbackV1,
} from "#migration/handoff-network/plex-edition.ts";
import {
  ExternalEditionTargetSchema,
  ExternalEditionReviewSchema,
  ExternalEditionApplySchema,
  ExternalEditionResultSchema,
  type ExternalEditionReview,
  type ExternalEditionResult,
} from "./contract.ts";
import type { ExternalEditionStore } from "./records.ts";

type Context = {
  plex: Pick<
    PlexClient,
    "machineIdentifier" | "metadataForEditionEdit" | "editMovieEdition"
  >;
  store: ExternalEditionStore;
  expectedServerMachineId: string;
  permittedMovieSection: () => Promise<string>;
};
const protectedEdit = () =>
  new MediaError(
    "external_edition_changed",
    "Review the current exact movie and registered edition before correcting its label",
    409,
  );

/** Owner-approved PMS field edits convey no filesystem or Media ownership authority. */
export function createExternalEditionCorrection(context: Context) {
  async function snapshot(
    actor: MediaActor,
    review: Pick<ExternalEditionReview, "target">,
    signal: AbortSignal,
    authorizedMedia?: Awaited<ReturnType<ExternalEditionStore["media"]>>,
  ) {
    requireOwner(actor);
    if (actor.restricted) throw protectedEdit();
    const media =
      authorizedMedia ??
      (await context.store.media(actor, review.target.mediaId));
    const sectionId = await context.permittedMovieSection();
    const serverMachineId = await context.plex.machineIdentifier(signal);
    if (
      serverMachineId !== context.expectedServerMachineId ||
      media.kind !== "movie"
    )
      throw protectedEdit();
    const canonical = {
      rootMediaId: media.id,
      title: media.title,
      aliases: media.aliases,
    };
    const canonicalHash = identityHash(canonical);
    const cut = conventionalMovieCutTexts(
      analyzeCutTexts({
        canonical: { ...canonical, digest: canonicalHash },
        attribution: "legacy_primary",
        texts: [
          {
            text: path.basename(review.target.canonicalPath),
            provenance: { kind: "release-title", field: "sourceFileName" },
          },
        ],
      }),
    );
    if (
      cut.issues.length > 0 ||
      !movieCutMatches(review.target.edition, cut.conclusion)
    )
      throw protectedEdit();
    const before = capturePlexEditionSnapshotV1(
      await context.plex.metadataForEditionEdit(
        review.target.ratingKey,
        signal,
      ),
      {
        serverMachineId,
        sectionId,
        media,
        canonicalPath: review.target.canonicalPath,
        sizeBytes: review.target.sizeBytes,
      },
    );
    if (
      before.identity.sizeBytes !== review.target.sizeBytes ||
      (await context.plex.machineIdentifier(signal)) !== serverMachineId
    )
      throw protectedEdit();
    signal.throwIfAborted();
    return { before, mediaVersion: media.version, canonicalHash };
  }
  async function preview(
    actor: MediaActor,
    raw: z.input<typeof ExternalEditionTargetSchema>,
  ) {
    const target = ExternalEditionTargetSchema.parse(raw);
    if (path.posix.normalize(target.canonicalPath) !== target.canonicalPath)
      throw protectedEdit();
    const signal = AbortSignal.timeout(60_000);
    const observed = await snapshot(actor, { target }, signal);
    const body = {
      schemaVersion: 1 as const,
      actorId: actor.id,
      actorVersion: actor.version,
      target,
      ...observed,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    return ExternalEditionReviewSchema.parse({
      ...body,
      reviewHash: identityHash(body),
    });
  }
  async function apply(
    actor: MediaActor,
    raw: z.input<typeof ExternalEditionApplySchema>,
  ): Promise<ExternalEditionResult> {
    const { operationId, review } = ExternalEditionApplySchema.parse(raw);
    assertReviewActor(actor, review);
    const signal = AbortSignal.timeout(60_000);
    await context.store.media(actor, review.target.mediaId);
    const prior = await context.store.read(review);
    if (prior !== null) {
      if (
        prior.intent.operationId !== operationId ||
        identityHash(prior.intent.review) !== identityHash(review)
      )
        throw protectedEdit();
      if (prior.completion !== null) {
        assertCompletion(prior.completion, { operationId, review });
        return prior.completion;
      }
      return finish(
        actor,
        { operationId, review, response: "lost_or_unobserved" },
        signal,
      );
    }
    if (Date.parse(review.expiresAt) <= Date.now()) throw protectedEdit();
    if (Date.parse(review.expiresAt) > Date.now() + 60_000)
      throw protectedEdit();
    const current = await snapshot(actor, review, signal);
    assertReviewed(review, current);
    const created = await context.store.begin(actor, {
      kind: "external_plex_edition_intent_v1",
      operationId,
      review,
    });
    if (!created)
      return finish(
        actor,
        { operationId, review, response: "lost_or_unobserved" },
        signal,
      );
    let response: ExternalEditionResult["response"] = "not_sent";
    if (
      (review.before.editionTitle ?? "") !==
      MOVIE_EDITION_REGISTRY[review.target.edition].plexLabel
    ) {
      const submission = { sent: false };
      try {
        await context.store.authorized(
          actor,
          review,
          async (media, assertActive) => {
            assertReviewed(
              review,
              await snapshot(actor, review, signal, media),
            );
            await assertActive();
            if (Date.parse(review.expiresAt) <= Date.now())
              throw protectedEdit();
            signal.throwIfAborted();
            submission.sent = true;
            await context.plex.editMovieEdition(
              {
                sectionId: review.before.identity.sectionId,
                ratingKey: review.target.ratingKey,
                edition: review.target.edition,
              },
              signal,
            );
            response = "acknowledged";
          },
        );
      } catch (error) {
        if (!submission.sent || signal.aborted) throw error;
        response = "lost_or_unobserved";
      }
    }
    return finish(actor, { operationId, review, response }, signal);
  }
  async function finish(
    actor: MediaActor,
    input: {
      operationId: string;
      review: ExternalEditionReview;
      response: ExternalEditionResult["response"];
    },
    signal: AbortSignal,
  ) {
    const { operationId, review, response } = input;
    const current = await snapshot(actor, review, signal);
    if (
      current.mediaVersion !== review.mediaVersion ||
      current.canonicalHash !== review.canonicalHash
    )
      throw protectedEdit();
    assertPlexEditionReadbackV1(
      review.before,
      current.before,
      review.target.edition,
    );
    const result = ExternalEditionResultSchema.parse({
      operationId,
      reviewHash: review.reviewHash,
      status: "completed",
      before: review.before,
      after: current.before,
      response,
    });
    await context.store.complete(actor, review, result);
    return result;
  }
  return { preview, apply };
}

function assertReviewed(
  review: ExternalEditionReview,
  current: {
    before: ExternalEditionReview["before"];
    canonicalHash: string;
    mediaVersion: number;
  },
) {
  if (
    current.mediaVersion !== review.mediaVersion ||
    current.canonicalHash !== review.canonicalHash ||
    identityHash(current.before) !== identityHash(review.before)
  )
    throw protectedEdit();
}

function assertReviewActor(actor: MediaActor, review: ExternalEditionReview) {
  requireOwner(actor);
  const { reviewHash, ...body } = review;
  if (
    actor.restricted ||
    path.posix.normalize(review.target.canonicalPath) !==
      review.target.canonicalPath ||
    reviewHash !== identityHash(body) ||
    review.actorId !== actor.id ||
    review.actorVersion !== actor.version
  )
    throw protectedEdit();
}

function assertCompletion(
  result: ExternalEditionResult,
  input: { operationId: string; review: ExternalEditionReview },
) {
  if (
    result.operationId !== input.operationId ||
    result.reviewHash !== input.review.reviewHash ||
    identityHash(result.before) !== identityHash(input.review.before)
  )
    throw protectedEdit();
  assertPlexEditionReadbackV1(
    result.before,
    result.after,
    input.review.target.edition,
  );
}
