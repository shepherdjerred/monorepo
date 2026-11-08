import { z } from "zod";
import type { ProviderCandidate } from "#integrations/providers.ts";
import { KnabenProvider } from "#integrations/providers.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import { MoviePublicationIntentV2Schema } from "#shared/movie-editions/publication-v2.ts";
import { createMovieRollbackFixture } from "./rollback-fixture.ts";
import { movieWorkflowWire } from "#testing/movie-workflow/wire.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";
import { createMovieNetworkFacetV4 } from "#automation/movie-editions/activities.ts";
import { PrismaMovieSubtitleReplacements } from "#infrastructure/movie-editions/subtitle-replacement/service.ts";
import { createMovieSubtitleReplacementFileFacet } from "#automation/movie-editions/subtitle-replacement/facet.ts";
import { assertRollbackHeldPredecessorGuards } from "./rollback-held-guards.ts";

type RollbackFixture = Awaited<ReturnType<typeof createMovieRollbackFixture>>;

/** Real rollback A is consumed by a new owner caption correction and by a later
 * genuine C acquisition. The provider continues to offer rejected B as well. */
export async function createMovieRollbackLineageFixture(
  edition: MovieEditionKey,
  bytes: { original: Uint8Array; upgrade: Uint8Array },
) {
  const f = await createMovieRollbackFixture(edition, bytes);
  return {
    ...f,
    replacement: () => prepareRollbackCaptionReplacement(f),
    laterC: () => prepareRollbackLaterCandidate(f, bytes.upgrade),
  };
}

export async function prepareRollbackLaterCandidate(
  f: RollbackFixture,
  bytes: Uint8Array,
) {
  const media = await f.db.mediaItem.findUniqueOrThrow({
    where: { id: f.scope.mediaId },
  });
  const request = await requestTestMovieV4(
    f.db,
    f.network.actor,
    media.id,
    f.scope.edition,
  );
  const wire = movieWorkflowWire(f.db, {
    mediaId: media.id,
    edition: f.scope.edition,
    title: media.title,
    year: z.number().parse(media.year),
    downloads: f.files.roots.movies.downloads,
    bytes,
    resolution: 2160,
    providerReleaseId: `synthetic-after-rollback:${media.id}:${f.scope.edition}`,
  });
  const query = { query: media.title, kind: "movie" as const, page: 1 };
  const rejected = await f.wire.providers.withProvider("knaben", (client) =>
    client.search(query),
  );
  const candidates = await wire.providers.withProvider("knaben", (client) =>
    client.search(query),
  );
  const next = candidates[0];
  if (next === undefined || rejected.length !== 1 || candidates.length !== 1)
    throw new Error(
      "Rollback lineage fixture requires both actual provider sources",
    );
  let includeC = false;
  const providers = {
    withProvider: <T>(
      _id: string,
      work: (client: KnabenProvider) => Promise<T>,
    ) =>
      work(
        new KnabenProvider(() =>
          Promise.resolve(
            Response.json({
              hits: (includeC ? [...rejected, next] : rejected).map((source) =>
                providerHit(source),
              ),
            }),
          ),
        ),
      ),
  };
  return {
    input: request.input,
    movie: createMovieNetworkFacetV4({ ...f.context, ...wire, providers }),
    wire,
    offerC: () => {
      includeC = true;
    },
    expectedHash: next.infoHash,
    captureControls: (attemptId: string) =>
      assertRollbackHeldPredecessorGuards(f.db, attemptId),
    async publication(attemptId: string) {
      const row = await f.db.mediaPublicationTransition.findUniqueOrThrow({
        where: { attemptId },
      });
      return MoviePublicationIntentV2Schema.parse(row.intent);
    },
  };
}

function providerHit(source: ProviderCandidate) {
  return {
    id: source.providerReleaseId,
    title: source.title,
    bytes: source.sizeBytes,
    hash: source.infoHash,
    seeders: source.seeders,
    details: source.detailsUrl,
    magnetUrl: null,
  };
}

async function prepareRollbackCaptionReplacement(f: RollbackFixture) {
  const owner = await f.db.mediaUser.findFirstOrThrow({
    where: { role: "owner", restricted: false },
  });
  const asset = await f.db.libraryAsset.findUniqueOrThrow({
    where: { id: f.asset.id },
  });
  const old = await f.db.subtitleAsset.findFirstOrThrow({
    where: {
      assetId: asset.id,
      state: "installed",
      storageKind: "sidecar",
      language: "en",
    },
  });
  const service = new PrismaMovieSubtitleReplacements(
    f.db,
    { keepDays: 30, serverMachineId: "fixture-server", movieSectionId: "1" },
    f.context.describeWorkflow,
  );
  const uploaded = await service.upload(owner, crypto.randomUUID(), {
    schemaVersion: 2,
    scope: f.scope,
    assetId: asset.id,
    expectedAssetVersion: asset.version,
    expectedChecksum: z.string().parse(asset.checksum),
    language: "en",
    forced: z.boolean().parse(old.forced),
    hearingImpaired: z.boolean().parse(old.hearingImpaired),
    filename: "rollback-owner-corrected.srt",
    description:
      "Owner verified corrected dialogue for the physically restored movie cut",
    contentBase64: Buffer.from(
      "1\n00:00:00,000 --> 00:00:01,500\nActual corrected dialogue after rollback.\n",
    ).toString("base64"),
    declaredEncoding: "utf8",
    confirmedMatchingVideo: true,
    replacementFor: { oldSubtitleId: old.id, expectedOldVersion: old.version },
  });
  const candidate = await f.db.subtitleAsset.findUniqueOrThrow({
    where: { id: z.uuid().parse(uploaded.subtitleId) },
  });
  const prepared = await service.prepare(owner, crypto.randomUUID(), {
    schemaVersion: 2,
    scope: f.scope,
    oldSubtitleId: old.id,
    candidateSubtitleId: candidate.id,
    expectedOldVersion: old.version,
    expectedCandidateVersion: candidate.version,
  });
  const replacementId = z.uuid().parse(prepared.subtitleReplacementId);
  const row = () =>
    f.db.subtitleReplacement.findUniqueOrThrow({
      where: { id: replacementId },
      include: { review: true, receipt: true },
    });
  return {
    prepareInput: {
      replacementId,
      operationId: z.uuid().parse(prepared.operationId),
      movieScope: f.scope,
    },
    movieReplacement: createMovieSubtitleReplacementFileFacet(f.files),
    row,
    async approve() {
      const current = await row();
      const command = await service.review.apply(
        owner,
        crypto.randomUUID(),
        replacementId,
        {
          expectedVersion: current.version,
          observationHash: z.string().parse(current.review?.observationHash),
          acknowledgeReplacement: true,
        },
      );
      return {
        replacementId,
        operationId: z.uuid().parse(command.operationId),
        movieScope: f.scope,
      };
    },
  };
}
