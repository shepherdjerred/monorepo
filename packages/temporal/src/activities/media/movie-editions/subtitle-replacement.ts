import type { createMediaFileRuntime } from "@shepherdjerred/media/automation/network";
import type {
  SubtitleReplacementFileActivities,
  SubtitleReplacementInput,
} from "@shepherdjerred/media/subtitle-replacement";
import { PublicationAuthorityReadBudget } from "@shepherdjerred/media/publication-authority-budget";
import { compensationCall } from "#activities/media/compensation-execution.ts";

/** A schema2 input retains the real SDK capability and original allowance before cold loading. */
export function callMovieSubtitleReplacementV2(
  load: () => Promise<
    Pick<Awaited<ReturnType<typeof createMediaFileRuntime>>, "movieReplacement">
  >,
  phase: keyof SubtitleReplacementFileActivities,
  input: SubtitleReplacementInput,
) {
  const observed = { wall: Date.now(), monotonic: performance.now() };
  const budget = new PublicationAuthorityReadBudget();
  return compensationCall(async (sdk) => {
    const runtime = await load();
    sdk.assertActive();
    return runtime.movieReplacement(phase, input, {
      execution: {
        ...sdk,
        observed,
        checkpoint: () => sdk.checkpoint("movie-subtitle-replacement"),
      },
      budget,
    });
  });
}
