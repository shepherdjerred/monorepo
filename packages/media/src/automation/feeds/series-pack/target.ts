import { MediaError } from "#application/errors.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { assessDefaultFeedCandidate } from "#automation/acquisition-candidates.ts";
import { NativeArchiveScopeProtection } from "#infrastructure/native-archive/errors.ts";
import type { MatchFeedSourceV1 } from "#shared/feeds/contract.ts";
import { CapturedSeriesPackV1Schema } from "#shared/acquisition/series-pack-v1.ts";
import type { ProviderCandidate } from "#integrations/providers.ts";
import { feedTargetMayMatch } from "#automation/feeds/prefilter.ts";
import type { FeedMatchTarget } from "#automation/feeds/selection.ts";
import { commitSeriesPackFeedV1 } from "./commit.ts";

export async function matchSeriesPackFeedTargetV1(
  context: MediaAutomationContext,
  input: {
    command: MatchFeedSourceV1;
    target: FeedMatchTarget;
    source: ProviderCandidate;
    completed: boolean;
  },
) {
  const invocation = context.libraryManagement;
  if (invocation === undefined)
    throw new Error("Series pack target lost its original invocation");
  const { target, source } = input;
  try {
    if (!feedTargetMayMatch(target, source))
      return { status: "rejected" as const, protection: null };
    const selected = await assessDefaultFeedCandidate(
      context,
      target.mediaId,
      source,
      invocation.budget,
    );
    if (selected === null)
      return { status: "rejected" as const, protection: null };
    if (!("seriesPackV1" in selected))
      throw new Error(
        "Explicit series pack feed selected a legacy interpretation",
      );
    const progress = await commitSeriesPackFeedV1(context, {
      command: input.command,
      target,
      captured: CapturedSeriesPackV1Schema.parse(selected.seriesPackV1),
      providerId: source.providerId,
      completed: input.completed,
    });
    return progress === null
      ? { status: "paused" as const }
      : { status: "committed" as const, progress };
  } catch (error) {
    if (
      !(error instanceof NativeArchiveScopeProtection) &&
      !(
        error instanceof MediaError &&
        [
          "series_pack_interpretation_changed",
          "library_management_unconfirmed",
          "plex_library_access_required",
        ].includes(error.code)
      )
    )
      throw error;
    return {
      status: "rejected" as const,
      protection: { mediaId: target.mediaId, reason: error.code },
    };
  }
}
