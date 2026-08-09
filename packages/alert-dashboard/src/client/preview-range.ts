import { Temporal } from "@js-temporal/polyfill";

import type { AlertDetail, PreviewInput } from "#shared/schema";
import { epochNanosecondsToInstantText } from "#shared/time";

const CONTEXT_DURATION = { minutes: 5 };
const MAX_PREVIEW_DURATION = { hours: 24 };

function later(
  left: Temporal.Instant,
  right: Temporal.Instant,
): Temporal.Instant {
  return Temporal.Instant.compare(left, right) > 0 ? left : right;
}

function earlier(
  left: Temporal.Instant,
  right: Temporal.Instant,
): Temporal.Instant {
  return Temporal.Instant.compare(left, right) < 0 ? left : right;
}

export function occurrencePreviewRange(
  alert: Pick<AlertDetail, "openedAt" | "resolvedAt">,
  now: Temporal.Instant,
): Pick<PreviewInput, "from" | "to"> {
  const opened = Temporal.Instant.from(alert.openedAt);
  const resolved =
    alert.resolvedAt === null ? null : Temporal.Instant.from(alert.resolvedAt);
  const to =
    resolved === null ? now : earlier(resolved.add(CONTEXT_DURATION), now);
  const from = later(
    opened.subtract(CONTEXT_DURATION),
    to.subtract(MAX_PREVIEW_DURATION),
  );
  return {
    from: epochNanosecondsToInstantText(from.epochNanoseconds),
    to: epochNanosecondsToInstantText(to.epochNanoseconds),
  };
}
