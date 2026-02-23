const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export type DowntimeInfo = {
  downtimeDetected: boolean;
  downtimeDurationMs: number;
  lastPollAt: Date | undefined;
  startupAt: Date;
  shouldBackfill: boolean;
  shouldNotifyOffline: boolean;
};

export function detectDowntime(
  lastPollAt: Date | undefined,
  startupAt: Date,
): DowntimeInfo {
  if (lastPollAt === undefined) {
    return {
      downtimeDetected: false,
      downtimeDurationMs: 0,
      lastPollAt: undefined,
      startupAt,
      shouldBackfill: false,
      shouldNotifyOffline: false,
    };
  }

  const downtimeDurationMs = startupAt.getTime() - lastPollAt.getTime();

  return {
    downtimeDetected: downtimeDurationMs > THIRTY_MINUTES_MS,
    downtimeDurationMs,
    lastPollAt,
    startupAt,
    shouldBackfill: downtimeDurationMs > THIRTY_MINUTES_MS,
    shouldNotifyOffline: downtimeDurationMs > ONE_DAY_MS,
  };
}
