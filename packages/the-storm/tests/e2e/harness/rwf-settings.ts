import type { RwfOverlay } from "./config-overlays.ts";

/**
 * The rwf.yml overrides the e2e server plays with: the fixture worlds, a lone
 * human starts a match, and a short countdown and end screen. The pinned rules
 * (the 60 s fuse and the payouts among them) have no knob and run as shipped.
 * Shared by the staging code and the fake brain's Flipt double, which admits
 * this world.
 */
export const rwfTestSettings: RwfOverlay = {
  world: "rwf",
  lobbyWorld: "rwf_lobby",
  // With the match flow flag on: the vote closes 3 s before the 6 s countdown
  // ends, a 3 s preview and a 2 s freeze.
  voteLead: "PT3S",
  previewLength: "PT3S",
  freezeLength: "PT2S",
  minHumans: 1,
  countdown: "PT6S",
  endLinger: "PT3S",
  noHumansAbort: "PT5S",
};

/**
 * The map the gameplay suites are written against. The rotation opens on the
 * first map in id order, so they stage the training yard alone.
 */
export const suiteMaps = ["training-yard"];

/** The full lane leaves time for staggered bot arrivals and lobby activity. */
export const fullRwfTestSettings: RwfOverlay = {
  ...rwfTestSettings,
  countdown: "PT25S",
};

/** The pseudonym salt the test server runs with: a fixed test value, never a secret. */
export const rwfRecordingSalt = "storm-e2e-recording-salt";
