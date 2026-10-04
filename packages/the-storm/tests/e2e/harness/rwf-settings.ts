import type { RwfOverlay } from "./config-overlays.ts";

/**
 * The rwf.yml overrides the e2e server plays with: the fixture world, a lone
 * human starts a match, a short countdown and end screen. The pinned rules
 * (the 60 s fuse among them) have no knob and run as shipped. Shared by the
 * staging code and the fake brain's Flipt double, which admits this world.
 */
export const rwfTestSettings: RwfOverlay = {
  world: "rwf",
  minHumans: 1,
  countdown: "PT6S",
  endLinger: "PT3S",
  noHumansAbort: "PT5S",
};

/** The pseudonym salt the test server runs with: a fixed test value, never a secret. */
export const rwfRecordingSalt = "storm-e2e-recording-salt";
