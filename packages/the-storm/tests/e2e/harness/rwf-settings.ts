import type { RwfOverlay } from "./config-overlays.ts";

/** Full-profile bots arrive during this countdown, rather than the six-second basic one. */
export const rwfFullCountdownSeconds = 25;

/**
 * The rwf.yml overrides the e2e server plays with: the fixture world, a lone
 * human starts a match, a short countdown and end screen, and a daily cap of
 * one win (3 credits) so a second paid match proves the cap. The pinned rules
 * (the 60 s fuse among them) have no knob and run as shipped. Shared by the
 * staging code and the fake brain's Flipt double, which admits this world.
 */
export const rwfTestSettings: RwfOverlay = {
  world: "rwf",
  minHumans: 1,
  countdown: "PT6S",
  endLinger: "PT3S",
  noHumansAbort: "PT5S",
  dailyCap: 3,
};

/** The full lane leaves time for staggered bot arrivals and lobby activity. */
export const fullRwfTestSettings: RwfOverlay = {
  ...rwfTestSettings,
  countdown: "PT25S",
};

/** The pseudonym salt the test server runs with: a fixed test value, never a secret. */
export const rwfRecordingSalt = "storm-e2e-recording-salt";
