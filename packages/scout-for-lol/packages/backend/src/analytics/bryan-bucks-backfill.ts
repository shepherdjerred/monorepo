import { v5 as uuidv5 } from "uuid";

/** Stable namespace for all historical Bryan Bucks PostHog event IDs. */
export const BRYAN_BUCKS_ANALYTICS_EVENT_NAMESPACE =
  "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

export function deterministicBucksAnalyticsEventId(
  kind: string,
  id: number | string,
  suffix?: string,
): string {
  return uuidv5(
    `${kind}:${id.toString()}:${suffix ?? ""}`,
    BRYAN_BUCKS_ANALYTICS_EVENT_NAMESPACE,
  );
}
