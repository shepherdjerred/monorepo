import type { MediaIntent } from "#generated/prisma/client.ts";

type Target = Pick<
  MediaIntent,
  "libraryMonitoring" | "desiredPresence" | "monitoring" | "automationEpoch"
>;

/** Personal consent changes cannot obsolete an independent, unchanged household acquisition. */
export function personalRequestGenerationChange(
  target: Target | null | undefined,
  epoch?: number,
) {
  const retained =
    target?.libraryMonitoring === true &&
    target.desiredPresence &&
    target.monitoring &&
    (epoch === undefined || target.automationEpoch === epoch);
  return retained ? {} : { generation: { increment: 1 } };
}

export function requestMonitoring(
  target: Pick<MediaIntent, "libraryMonitoring"> | null,
  count: number,
) {
  return count > 0 || target?.libraryMonitoring === true;
}
