import type { PostHog } from "posthog-js";
import { ANALYTICS_SITE } from "@shepherdjerred/streambot/web/shared/analytics-site.ts";
import type { TelemetryEvent } from "./events.ts";
import { analyticsConfig } from "./posthog-config.ts";
import { productionHost, trackingAllowed } from "./privacy.ts";

/**
 * Product analytics for the web remote, backed by PostHog through the managed `j.sjer.red` proxy.
 *
 * The SDK is loaded only on the registered production host, for a signed-in viewer whose
 * `/api/me` carries an `analyticsId` (the
 * server's usage-analytics flag is on) and whose browser sends neither Do Not Track nor Global
 * Privacy Control; otherwise nothing is downloaded and nothing is sent. The distinct id is that
 * random `analyticsId`, the same one the server's usage events use, never a Discord id.
 */

type Pending = Pick<TelemetryEvent, "event" | "properties">;
/** Events held while the SDK downloads; a few seconds of clicks at most. */
const MAX_PENDING = 50;
type State =
  | { readonly status: "off" }
  | { readonly status: "loading"; readonly queue: Pending[] }
  | { readonly status: "on"; readonly client: PostHog };

let state: State = { status: "off" };

function browserAllowsTracking(): boolean {
  return trackingAllowed({
    doNotTrack: navigator.doNotTrack,
    windowDoNotTrack: Reflect.get(globalThis, "doNotTrack"),
    globalPrivacyControl: Reflect.get(navigator, "globalPrivacyControl"),
  });
}

async function load(analyticsId: string, queue: Pending[]): Promise<void> {
  const siteOrigin = location.origin;
  let posthog: PostHog;
  try {
    ({ default: posthog } = await import("posthog-js"));
  } catch {
    // The chunk is first-party; a failed download means the page is going away or offline.
    state = { status: "off" };
    return;
  }
  posthog.init(ANALYTICS_SITE.projectToken, {
    ...analyticsConfig(analyticsId, siteOrigin),
    loaded: (instance) => {
      instance.register({
        site_key: ANALYTICS_SITE.siteKey,
        site_hostname: ANALYTICS_SITE.hostname,
      });
    },
  });
  // Bootstrap only applies to a browser with no stored identity. A browser that still holds
  // another viewer's identity is reset first so two people never merge into one.
  if (posthog.get_distinct_id() !== analyticsId) {
    if (posthog._isIdentified()) posthog.reset();
    posthog.identify(analyticsId);
  }
  state = { status: "on", client: posthog };
  for (const pending of queue)
    posthog.capture(pending.event, pending.properties);
}

/** Loads PostHog for this viewer once, when the browser allows it. */
export function startAnalytics(analyticsId: string): void {
  if (
    state.status !== "off" ||
    !productionHost(location.host, ANALYTICS_SITE.hostname) ||
    !browserAllowsTracking()
  )
    return;
  const queue: Pending[] = [];
  state = { status: "loading", queue };
  void load(analyticsId, queue);
}

/** Sends one event; held while the SDK downloads, dropped when analytics is off. */
export function capture(telemetry: TelemetryEvent): void {
  switch (state.status) {
    case "off":
      return;
    case "loading":
      if (state.queue.length >= MAX_PENDING) return;
      state.queue.push({
        event: telemetry.event,
        properties: telemetry.properties,
      });
      return;
    case "on":
      state.client.capture(telemetry.event, telemetry.properties);
  }
}
