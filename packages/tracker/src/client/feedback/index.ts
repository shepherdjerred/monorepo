import { useSyncExternalStore } from "react";
import { vibrate } from "./haptics.ts";
import { prefersReducedMotion } from "./motion.ts";
import {
  allowed,
  createFeedback,
  type Channel,
  type FeedbackEvent,
} from "./policy.ts";
import { createPreferences } from "./preferences.ts";
import { playCue, prepareAudio } from "./sound.ts";

export const feedbackPreferences = createPreferences(() => localStorage);

/**
 * Browsers only let a page make sound or vibrate after the person has
 * interacted with it. The first gesture also starts the audio context, so
 * the first cue is not lost to its start-up.
 */
let gestured = false;
function onGesture(event: Event) {
  if (!event.isTrusted) {
    return;
  }
  gestured = true;
  if (feedbackPreferences.read("sound") && !prefersReducedMotion()) {
    prepareAudio();
  }
}
for (const type of ["pointerdown", "keydown", "touchend"]) {
  globalThis.addEventListener(type, onGesture, {
    capture: true,
    passive: true,
  });
}

// Safari before 16.4 has no `userActivation`; the listeners above cover it.
const hasBeenActive = () =>
  gestured ||
  ("userActivation" in navigator && navigator.userActivation.hasBeenActive);

const conditions = (channel: Channel) => ({
  enabled: feedbackPreferences.read(channel),
  reducedMotion: prefersReducedMotion(),
  hidden: document.visibilityState === "hidden",
  gestured: hasBeenActive(),
});

/**
 * Acknowledge something this person just did. Call it where the outcome
 * happens — a mutation, a toast, an event handler — never while rendering,
 * and never for changes that arrived from another session.
 */
export const feedback: (event: FeedbackEvent) => void = createFeedback({
  conditions,
  now: () => performance.now(),
  later: (run, ms) => {
    setTimeout(run, ms);
  },
  play: playCue,
  vibrate,
});

/** The Settings sample: the completion cue, as the switches allow. */
export function playSample() {
  if (allowed(conditions("sound"))) {
    playCue("complete");
  }
}

export function useFeedbackPreference(channel: Channel) {
  return useSyncExternalStore(feedbackPreferences.subscribe, () =>
    feedbackPreferences.read(channel),
  );
}
