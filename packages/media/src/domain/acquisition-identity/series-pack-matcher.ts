import type { ReleaseMatchInput } from "#domain/release-parser.ts";
import { matchRelease } from "#domain/release-parser.ts";
import type { CoordinateSnapshot } from "#shared/acquisition/coordinates.ts";
import {
  parseSeriesSeasonSetV1,
  resolveSeriesSeasonSetV1,
} from "./series-season-set.ts";

/** Replace only the old parser's unsupported coverage result after proving one explicit whole-season set. */
export function matchSeriesPackReleaseV1(
  input: ReleaseMatchInput,
  snapshot: CoordinateSnapshot,
) {
  const { manualMapping: _mapping, ...literal } = input;
  const matched = matchRelease(literal);
  const parsed = parseSeriesSeasonSetV1(input.title);
  if (parsed.status !== "resolved")
    return {
      status: "protected" as const,
      reason:
        parsed.status === "protected" ? parsed.reason : "season_set_required",
    };
  if (input.media.kind === "movie")
    return {
      status: "protected" as const,
      reason: "series_pack_requires_series",
    };
  const closure = resolveSeriesSeasonSetV1(parsed.range, snapshot);
  if (closure.status !== "resolved") return closure;
  const reasons = matched.reasons.filter(
    (reason) =>
      reason !== "episode_range_invalid" &&
      reason !== "requested_episode_missing",
  );
  if (
    input.media.kind === "episode" &&
    !closure.mediaIds.includes(input.media.id)
  )
    reasons.push("requested_episode_missing");
  const identityConfidence =
    reasons.length === 0
      ? ("exact" as const)
      : reasons.some(
            (reason) =>
              reason.includes("mismatch") || reason.includes("conflict"),
          )
        ? ("mismatch" as const)
        : ("ambiguous" as const);
  return {
    status: "resolved" as const,
    attributes: {
      ...matched.attributes,
      mediaIds: closure.mediaIds,
      identityConfidence,
    },
    reasons,
    range: parsed.range,
  };
}
