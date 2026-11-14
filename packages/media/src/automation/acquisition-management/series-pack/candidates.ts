import type { MediaAutomationContext } from "#automation/context.ts";
import type { ProviderCandidate } from "#integrations/providers.ts";
import type { ReleaseAttributes, QualityProfile } from "#shared/contract.ts";
import {
  matchRelease,
  type ReleaseMatchInput,
} from "#domain/release-parser.ts";
import { chooseUpgrade } from "#domain/quality.ts";
import { providerCandidateAdmission } from "#automation/provider-selection.ts";
import { parseSeriesSeasonSetV1 } from "#domain/acquisition-identity/series-season-set.ts";
import { persistCandidateSnapshot } from "#automation/candidate-evidence.ts";
import { assessSeriesPackV1 } from "./assessment.ts";
import { seriesPackChanged } from "#infrastructure/acquisition-identity/series-pack/catalog.ts";

/** Undefined selects the literal old producer. An explicit range never falls back to old coverage. */
export async function storeSeriesPackCandidateV1(
  context: MediaAutomationContext,
  input: {
    source: ProviderCandidate;
    literal: ReleaseMatchInput;
    profile: QualityProfile;
    current: ReleaseAttributes | null;
    matchedOnly?: boolean;
  },
) {
  if (input.literal.media.kind === "movie") return;
  const syntax = parseSeriesSeasonSetV1(input.source.title);
  if (syntax.status === "not_applicable") return;
  const invocation = context.libraryManagement;
  if (invocation === undefined)
    throw seriesPackChanged(
      "The source producer needs its original caller-owned allowance",
    );
  invocation.freshness.assertActive();
  const existing = await context.db.releaseCandidate.findUnique({
    where: {
      providerId_providerReleaseId: {
        providerId: input.source.providerId,
        providerReleaseId: input.source.providerReleaseId,
      },
    },
  });
  invocation.budget.consume(existing === null ? 0 : 1);
  let releaseId = existing?.id;
  if (releaseId === undefined) {
    // This is an actual legacy parse performed now, retained independently of the new interpretation.
    const literal = matchRelease(input.literal).attributes;
    const legacy = chooseUpgrade({
      phase: "listing",
      candidate: literal,
      profile: input.profile,
      current: input.current,
      mediaIds: [input.literal.media.id],
    });
    const retained = await persistCandidateSnapshot(context, {
      source: input.source,
      attributes: literal,
      evaluation: legacy.evaluation,
      searchedForMediaId: input.literal.media.id,
      budget: invocation.budget,
    });
    if (retained === null) {
      const raced = await context.db.releaseCandidate.findUniqueOrThrow({
        where: {
          providerId_providerReleaseId: {
            providerId: input.source.providerId,
            providerReleaseId: input.source.providerReleaseId,
          },
        },
      });
      invocation.budget.consume(1);
      releaseId = raced.id;
    } else releaseId = retained.id;
  }
  if (syntax.status !== "resolved") return null;
  const interpreted = await assessSeriesPackV1(context, {
    releaseId,
    primaryMediaId: input.literal.media.id,
    observedSource: input.source,
  });
  if (
    interpreted.value.profile.id !== input.profile.id ||
    interpreted.value.profile.version !== input.profile.version
  )
    throw seriesPackChanged(
      "Current source assessment changed its actual quality profile",
    );
  const candidate = {
    id: releaseId,
    providerId: input.source.providerId,
    title: input.source.title,
    ...interpreted.value.attributes,
  };
  if (
    input.matchedOnly === true &&
    !candidate.mediaIds.includes(input.literal.media.id)
  )
    return null;
  const selected = chooseUpgrade({
    phase: "listing",
    candidate,
    current: input.current,
    profile: input.profile,
    mediaIds: [input.literal.media.id],
  });
  invocation.freshness.assertActive();
  if (!selected.upgrade) return null;
  const admission = await providerCandidateAdmission(context, {
    releaseId,
    mediaId: input.literal.media.id,
    rank: selected.evaluation.qualityRank,
    profile: input.profile,
  });
  if (!admission.accepted) return null;
  return {
    id: releaseId,
    rank: selected.evaluation.qualityRank,
    score: selected.evaluation.score,
    priority: admission.priority,
    seriesPackV1: interpreted.captured,
  };
}
