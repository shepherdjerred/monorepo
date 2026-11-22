import type { z } from "zod";
import type { SubtitlePolicySatisfactionSchema } from "#shared/subtitle-policy.ts";
import { humanize } from "#client/components.tsx";
import { Callout } from "#client/ui/feedback.tsx";

type Requirements = z.output<typeof SubtitlePolicySatisfactionSchema>;
type Target = Requirements["missing"][number];

function describeTarget(target: Target): string {
  const captions =
    target.hearingImpaired === "any"
      ? "HI captions optional"
      : target.hearingImpaired === "required"
        ? "HI captions required"
        : "Without HI captions";
  return `${target.language}, ${target.forced ? "forced dialogue" : "regular subtitles"}, ${captions}`;
}

/**
 * Whether a file has the subtitles the household's policy asks of it, and
 * which it still lacks. A warning while any are missing; the reasons the
 * policy is protected are listed beneath.
 */
export function SubtitleRequirements({ status }: { status: Requirements }) {
  return (
    <Callout
      tone={status.satisfied ? "ok" : "warn"}
      title={
        status.satisfied
          ? "Subtitle requirements met"
          : "Subtitle requirements pending"
      }
    >
      {(status.missing.length > 0 ||
        status.householdMissing.length > 0 ||
        status.protectedReasons.length > 0) && (
        <ul>
          {status.missing.map((target) => (
            <li key={target.sourceItemId}>{describeTarget(target)}</li>
          ))}
          {status.householdMissing.map((target) => (
            <li key={`household-${target.language}`}>
              English regular subtitles required for original-language playback
            </li>
          ))}
          {status.protectedReasons.map((reason) => (
            <li key={reason}>{humanize(reason)}</li>
          ))}
        </ul>
      )}
    </Callout>
  );
}
