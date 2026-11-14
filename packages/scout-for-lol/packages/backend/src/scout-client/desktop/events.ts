import { ScoutDesktopEventSchema } from "@scout-for-lol/data";
import { getProductAnalytics } from "#src/analytics/product-analytics.ts";
import type { AuthenticatedScoutClient } from "#src/scout-client/authentication.ts";

// The desktop client's product events (`SCOUT_DESKTOP_EVENTS_PATH`). The client
// never talks to PostHog: it posts a closed, bounded event here as an
// authenticated device, and the backend forwards it under the device owner's
// privacy-scoped identity.

const WINDOW_MS = 60_000;
/** A client sends a handful of events per session; this is generous headroom. */
const PER_DEVICE_LIMIT = 30;
const MAX_TRACKED_DEVICES = 10_000;

let windowStartedAt = Date.now();
const callsByDevice = new Map<string, number>();

/** Fixed-window limit per device, so one client cannot flood analytics. */
export function desktopEventAllowed(
  deviceId: string,
  now = Date.now(),
): boolean {
  if (now - windowStartedAt >= WINDOW_MS) {
    windowStartedAt = now;
    callsByDevice.clear();
  }
  const calls = (callsByDevice.get(deviceId) ?? 0) + 1;
  if (calls > PER_DEVICE_LIMIT) return false;
  if (calls > 1 || callsByDevice.size < MAX_TRACKED_DEVICES) {
    callsByDevice.set(deviceId, calls);
  }
  return true;
}

export function resetDesktopEventLimitForTests(now = Date.now()): void {
  windowStartedAt = now;
  callsByDevice.clear();
}

export type DesktopEventResult =
  | { status: 202 }
  | { status: 400; error: "invalid_request" }
  | { status: 429; error: "rate_limited" };

/** Validate one event strictly, rate-limit it per device, and forward it. */
export function acceptDesktopEvent(
  device: AuthenticatedScoutClient,
  body: unknown,
  analytics = getProductAnalytics(),
): DesktopEventResult {
  // Limit before validating: a malformed flood costs the same as a valid one.
  if (!desktopEventAllowed(device.deviceId)) {
    return { status: 429, error: "rate_limited" };
  }
  const event = ScoutDesktopEventSchema.safeParse(body);
  if (!event.success) return { status: 400, error: "invalid_request" };
  analytics.captureDesktop({ ownerId: device.ownerId }, event.data);
  return { status: 202 };
}
