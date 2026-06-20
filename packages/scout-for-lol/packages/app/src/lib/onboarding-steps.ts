import { match } from "ts-pattern";

/**
 * The guided new-user wizard is a linear flow with one optional branch at
 * the end (report vs competition). Steps + transitions are modelled as a
 * discriminated union driven by a reducer so the logic is pure and
 * unit-testable, with no `as` casts.
 */
export type OnboardingStepKind =
  | "install"
  | "pick-guild"
  | "concepts"
  | "subscribe-self"
  | "subscribe-more"
  | "done"
  | "choose-extra"
  | "build-report"
  | "build-competition";

export type ExtraChoice = "report" | "competition";

export type OnboardingState = {
  step: OnboardingStepKind;
  selectedGuildId: string | null;
  // Example preset picked on the "Report or competition?" page, used to
  // seed the build form.
  selectedExampleId: string | null;
};

export type OnboardingEvent =
  | { type: "next" }
  | { type: "back" }
  | { type: "goto"; step: OnboardingStepKind }
  | { type: "select-guild"; guildId: string }
  | { type: "choose"; extra: ExtraChoice; exampleId: string };

export const initialOnboardingState: OnboardingState = {
  step: "install",
  selectedGuildId: null,
  selectedExampleId: null,
};

// Steps reached via the linear "next" button. `install` / `pick-guild`
// advance through `select-guild`; the branch + done steps advance through
// their own explicit events, so they map to null here.
const FORWARD: Record<OnboardingStepKind, OnboardingStepKind | null> = {
  install: null,
  "pick-guild": null,
  concepts: "subscribe-self",
  "subscribe-self": "subscribe-more",
  "subscribe-more": "done",
  done: null,
  "choose-extra": null,
  "build-report": null,
  "build-competition": null,
};

const BACK: Record<OnboardingStepKind, OnboardingStepKind | null> = {
  install: null,
  "pick-guild": "install",
  concepts: "install",
  "subscribe-self": "concepts",
  "subscribe-more": "subscribe-self",
  done: "subscribe-more",
  "choose-extra": "done",
  "build-report": "choose-extra",
  "build-competition": "choose-extra",
};

export function onboardingReducer(
  state: OnboardingState,
  event: OnboardingEvent,
): OnboardingState {
  return match(event)
    .with({ type: "next" }, (): OnboardingState => {
      const next = FORWARD[state.step];
      return next === null ? state : { ...state, step: next };
    })
    .with({ type: "back" }, (): OnboardingState => {
      const prev = BACK[state.step];
      return prev === null ? state : { ...state, step: prev };
    })
    .with(
      { type: "goto" },
      (e): OnboardingState => ({ ...state, step: e.step }),
    )
    .with(
      { type: "select-guild" },
      (e): OnboardingState => ({
        ...state,
        step: "concepts",
        selectedGuildId: e.guildId,
      }),
    )
    .with(
      { type: "choose" },
      (e): OnboardingState => ({
        ...state,
        step: e.extra === "report" ? "build-report" : "build-competition",
        selectedExampleId: e.exampleId,
      }),
    )
    .exhaustive();
}

export const TOTAL_PROGRESS_STEPS = 5;

/** 1-based progress slot for the wizard's progress bar. */
export function progressStep(step: OnboardingStepKind): number {
  return match(step)
    .with("install", "pick-guild", () => 1)
    .with("concepts", () => 2)
    .with("subscribe-self", () => 3)
    .with("subscribe-more", () => 4)
    .with("done", "choose-extra", "build-report", "build-competition", () => 5)
    .exhaustive();
}

export function progressLabel(step: OnboardingStepKind): string {
  return match(step)
    .with("install", "pick-guild", () => "Add Scout")
    .with("concepts", () => "How it works")
    .with("subscribe-self", () => "Track yourself")
    .with("subscribe-more", () => "Add friends")
    .with(
      "done",
      "choose-extra",
      "build-report",
      "build-competition",
      () => "Finish",
    )
    .exhaustive();
}
