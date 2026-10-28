import { z } from "zod";
import type { Prisma, ReleaseCandidate } from "#generated/prisma/client.ts";
import type { ProviderCandidate } from "#integrations/providers.ts";
import { CandidateSourceEvidenceSchema } from "#shared/acquisition/identity.ts";
import { MediaError } from "#application/errors.ts";
import { parseMovieCutV2 } from "#domain/editions/parse-v2.ts";
import { evaluateMovieCutV2 } from "#domain/editions/selection-v2.ts";
import {
  cutCanonical,
  currentCuts,
  releaseCut,
} from "#infrastructure/editions/cut-context.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  MovieEditionScopeSchema,
  type MovieEditionScope,
} from "#shared/movie-editions/registry.ts";
import type { CutCanonical, CutEvidence } from "#shared/editions/evidence.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

const Member = z.strictObject({
  attemptId: z.uuid(),
  torrentFileIndex: z.int().nonnegative(),
  relativePath: z.string().min(1).max(4096),
  sizeBytes: z.string().regex(/^\d+$/u),
});
type Input = {
  scope: MovieEditionScope;
  releaseId: string;
  predecessorAssetIds: readonly string[];
  budget?: PublicationAuthorityReadBudget | undefined;
} & (
  | { phase: "candidate"; members: readonly [] }
  | { phase: "physical"; members: readonly z.infer<typeof Member>[] }
);

/** Reassess retained source facts into NEW evidence; no old assessment or receipt is rewritten. */
function assess(canonical: CutCanonical, prior: CutEvidence) {
  return parseMovieCutV2({
    source: prior.source,
    sourceDigest: prior.sourceDigest,
    canonical,
    attribution: prior.attribution,
    texts: prior.texts.map(({ text, provenance }) => ({ text, provenance })),
  });
}

export function retainedMovieCutV2(
  release: ReleaseCandidate,
  canonical: CutCanonical,
) {
  return assess(canonical, releaseCut(release, canonical));
}

/** Same source-column projection used before persistence and when rechecking its retained row. */
export function providerMovieCutV2(
  id: string,
  source: ProviderCandidate,
  canonical: CutCanonical,
) {
  const sourceEvidence = z.record(z.string(), z.json()).parse(
    CandidateSourceEvidenceSchema.parse({
      infoHash: source.infoHash.toLowerCase(),
      ...(source.references === undefined
        ? {}
        : { references: source.references }),
      ...(source.editionEvidence === undefined
        ? {}
        : { editionEvidence: source.editionEvidence }),
    }),
  );
  return assess(
    canonical,
    releaseCut(
      {
        id,
        providerId: source.providerId,
        providerReleaseId: source.providerReleaseId,
        title: source.title,
        sourceEvidence,
      },
      canonical,
    ),
  );
}

/** Read-only cut policy. Runtime, choice, quality and physical grants remain separate authority. */
export async function assessMovieCutV2(
  tx: Prisma.TransactionClient,
  input: Input,
) {
  const scope = MovieEditionScopeSchema.parse(input.scope);
  const media = await tx.mediaItem.findUniqueOrThrow({
    where: { id: scope.mediaId },
  });
  if (media.kind !== "movie")
    throw new Error("Movie cut assessment requires a canonical movie");
  const predecessors = z
    .array(z.uuid())
    .max(100)
    .parse(input.predecessorAssetIds);
  if (new Set(predecessors).size !== predecessors.length)
    throw new Error("Movie cut predecessors must be distinct");
  const canonical = await cutCanonical(tx, [media.id]);
  const release = await tx.releaseCandidate.findUniqueOrThrow({
    where: { id: input.releaseId },
  });
  input.budget?.consume(1);
  const candidate = assess(canonical, releaseCut(release, canonical));
  const assets = await tx.libraryAsset.findMany({
    where: {
      edition: scope.edition,
      editionRootId: scope.rootMediaId,
      OR: [
        {
          coverage: {
            some: {
              mediaId: scope.mediaId,
              edition: scope.edition,
              current: true,
            },
          },
        },
        { id: { in: predecessors } },
      ],
    },
    select: { id: true },
    orderBy: { id: "asc" },
    take: 101,
  });
  if (assets.length > 100)
    throw new Error("Movie cut coverage exceeds the existing physical bound");
  if (predecessors.some((id) => !assets.some((asset) => asset.id === id)))
    throw new MediaError(
      "movie_edition_asset_mismatch",
      "Predecessor does not belong to this movie edition",
      409,
    );
  // Select only the already scoped IDs; another current edition is never a predecessor.
  const retained =
    assets.length === 0
      ? []
      : await currentCuts(tx, canonical, {
          mediaIds: [],
          predecessorAssetIds: assets.map((asset) => asset.id),
          ...(input.budget === undefined ? {} : { budget: input.budget }),
        });
  const current = retained.map((evidence) => assess(canonical, evidence));
  const members = z
    .array(Member)
    .max(100)
    .parse(input.members)
    .map((member) =>
      parseMovieCutV2({
        source: {
          kind: "member",
          attemptId: member.attemptId,
          torrentFileIndex: member.torrentFileIndex,
        },
        sourceDigest: identityHash(member),
        canonical,
        attribution: "torrent_member",
        texts: [
          {
            text: member.relativePath,
            provenance: { kind: "release-title", field: "member.relativePath" },
          },
        ],
      }),
    );
  const decision = evaluateMovieCutV2({
    edition: scope.edition,
    phase: input.phase,
    candidate,
    current,
    members,
  });
  return { candidate, current, members, decision };
}

export async function assertMovieCutV2(
  tx: Prisma.TransactionClient,
  input: Input,
) {
  const evidence = await assessMovieCutV2(tx, input);
  if (!evidence.decision.accepted)
    throw new MediaError(
      evidence.decision.reasons[0] ?? "edition_candidate_incompatible",
      "Release and member labels do not establish the requested movie edition",
      409,
    );
  return evidence;
}
