// Large schedule `args` payloads, extracted from register-schedules.ts so that
// file stays within its line budget and its SCHEDULES array reads as a table of
// declarations rather than inline data blobs. Each constant is consumed only by
// a SCHEDULES entry's `args`.

export const SCOUT_LANE_PRIOR_UPDATE_CONFIG = {
  lanePriors: {
    bucket: "scout-prod",
    queueIds: [400, 420, 440, 480, 490],
    trainingStartDate: "2026-05-06",
    trainingEndDate: "2026-05-13",
    holdoutStartDate: "2026-05-14",
    holdoutEndDate: "2026-05-16",
    holdoutSampleSize: 100,
    holdoutSeed: "scout-lane-priors-patch-cadence-v1",
    threshold: 0.95,
  },
};
