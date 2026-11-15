const WINDOW_MS = 60_000;
const MAX_TRACKED_DEVICES = 10_000;

/** A fixed one-minute window per device credential, in this process. */
export type DeviceWindowLimiter = {
  readonly limit: number;
  readonly allow: (deviceId: string, now?: number) => boolean;
  readonly reset: (now?: number) => void;
};

/**
 * Modelled on `pairing-rate-limit.ts`, keyed by the authenticated device
 * rather than the edge caller. Tracking is bounded; past the bound an
 * untracked device is admitted rather than refused, as the pairing limiter
 * does for callers.
 */
export function deviceWindowLimiter(limit: number): DeviceWindowLimiter {
  let windowStartedAt = Date.now();
  const callsByDevice = new Map<string, number>();
  return {
    limit,
    allow(deviceId, now = Date.now()) {
      if (now - windowStartedAt >= WINDOW_MS) {
        windowStartedAt = now;
        callsByDevice.clear();
      }
      const calls = (callsByDevice.get(deviceId) ?? 0) + 1;
      if (calls > limit) return false;
      if (calls > 1 || callsByDevice.size < MAX_TRACKED_DEVICES) {
        callsByDevice.set(deviceId, calls);
      }
      return true;
    },
    reset(now = Date.now()) {
      windowStartedAt = now;
      callsByDevice.clear();
    },
  };
}

/**
 * Desktop Explore reads per device. Every read resolves the owner's Discord
 * guilds and reads Postgres, so one leaked or looping credential must not be
 * able to spend that on the owner's behalf without limit. Starting a turn is
 * limited separately by the per-user Explore quota every surface shares.
 */
const readLimiter = deviceWindowLimiter(60);

export const DESKTOP_READ_LIMIT_PER_MINUTE = readLimiter.limit;

export function desktopReadAllowed(
  deviceId: string,
  now = Date.now(),
): boolean {
  return readLimiter.allow(deviceId, now);
}

export function resetDesktopReadRateLimitForTests(now = Date.now()): void {
  readLimiter.reset(now);
}

/**
 * Chart renders per device. Drawing a chart is CPU-bound work on the request
 * path (ECharts to SVG to PNG), far costlier than a read, so a device gets a
 * third of its read budget for it. The desktop caches every chart it draws
 * on disk, so reopening a conversation does not spend it again.
 */
const renderLimiter = deviceWindowLimiter(20);

export const DESKTOP_RENDER_LIMIT_PER_MINUTE = renderLimiter.limit;

export function desktopRenderAllowed(
  deviceId: string,
  now = Date.now(),
): boolean {
  return renderLimiter.allow(deviceId, now);
}

export function resetDesktopRenderRateLimitForTests(now = Date.now()): void {
  renderLimiter.reset(now);
}

/**
 * Desktop Explore writes per device, by what they change. These sit on top of
 * the read limit and the per-user Explore quota, not instead of them: a turn
 * an edit or regenerate starts still spends the owner's quota and takes the
 * conversation's one active-run slot in `exploreRunManager.start`.
 *
 * - `share`: creating or revoking a share link, which changes who can read.
 * - `edit`: editing a question, regenerating an answer, and switching which
 *   version of a turn is on screen.
 * - `attachment`: image uploads and discards, which write to object storage.
 *   The owner's unsent and hourly upload caps still bound them in the store.
 */
export const DESKTOP_WRITE_LIMITS_PER_MINUTE = {
  share: 10,
  edit: 30,
  attachment: 20,
} as const;
export type DesktopWriteKind = keyof typeof DESKTOP_WRITE_LIMITS_PER_MINUTE;

const writeLimiters: Record<DesktopWriteKind, DeviceWindowLimiter> = {
  share: deviceWindowLimiter(DESKTOP_WRITE_LIMITS_PER_MINUTE.share),
  edit: deviceWindowLimiter(DESKTOP_WRITE_LIMITS_PER_MINUTE.edit),
  attachment: deviceWindowLimiter(DESKTOP_WRITE_LIMITS_PER_MINUTE.attachment),
};

export function desktopWriteAllowed(
  kind: DesktopWriteKind,
  deviceId: string,
  now = Date.now(),
): boolean {
  return writeLimiters[kind].allow(deviceId, now);
}

export function resetDesktopWriteRateLimitsForTests(now = Date.now()): void {
  for (const limiter of Object.values(writeLimiters)) limiter.reset(now);
}
