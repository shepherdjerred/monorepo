import { describe, expect, test } from "bun:test";
import {
  initialOnboardingState,
  onboardingReducer,
  progressStep,
  type OnboardingState,
  type OnboardingStepKind,
} from "#src/lib/onboarding-steps.ts";

describe("onboardingReducer", () => {
  test("starts on install with no guild", () => {
    expect(initialOnboardingState).toEqual({
      step: "install",
      selectedGuildId: null,
    });
  });

  test("select-guild sets the guild and jumps to concepts", () => {
    const next = onboardingReducer(initialOnboardingState, {
      type: "select-guild",
      guildId: "guild-123",
    });
    expect(next).toEqual({ step: "concepts", selectedGuildId: "guild-123" });
  });

  test("goto pick-guild then back returns to install", () => {
    const picking = onboardingReducer(initialOnboardingState, {
      type: "goto",
      step: "pick-guild",
    });
    expect(picking.step).toBe("pick-guild");
    const back = onboardingReducer(picking, { type: "back" });
    expect(back.step).toBe("install");
  });

  test("linear next chain advances concepts → done", () => {
    const start: OnboardingState = {
      step: "concepts",
      selectedGuildId: "g",
    };
    const a = onboardingReducer(start, { type: "next" });
    expect(a.step).toBe("subscribe-self");
    const b = onboardingReducer(a, { type: "next" });
    expect(b.step).toBe("subscribe-more");
    const c = onboardingReducer(b, { type: "next" });
    expect(c.step).toBe("done");
    // done has no forward step
    const d = onboardingReducer(c, { type: "next" });
    expect(d.step).toBe("done");
    // guild id is preserved across the chain
    expect(d.selectedGuildId).toBe("g");
  });

  test("back chain walks done → concepts", () => {
    const steps: OnboardingStepKind[] = [
      "subscribe-more",
      "subscribe-self",
      "concepts",
      "install",
    ];
    let state: OnboardingState = { step: "done", selectedGuildId: "g" };
    for (const expected of steps) {
      state = onboardingReducer(state, { type: "back" });
      expect(state.step).toBe(expected);
    }
  });

  test("install next is a no-op (advances via select-guild)", () => {
    const next = onboardingReducer(initialOnboardingState, { type: "next" });
    expect(next).toEqual(initialOnboardingState);
  });

  test("choose report routes to build-report", () => {
    const fromChoose: OnboardingState = {
      step: "choose-extra",
      selectedGuildId: "g",
    };
    const report = onboardingReducer(fromChoose, {
      type: "choose",
      extra: "report",
    });
    expect(report.step).toBe("build-report");
    const competition = onboardingReducer(fromChoose, {
      type: "choose",
      extra: "competition",
    });
    expect(competition.step).toBe("build-competition");
  });

  test("build steps go back to choose-extra", () => {
    const report: OnboardingState = {
      step: "build-report",
      selectedGuildId: "g",
    };
    expect(onboardingReducer(report, { type: "back" }).step).toBe(
      "choose-extra",
    );
    const competition: OnboardingState = {
      step: "build-competition",
      selectedGuildId: "g",
    };
    expect(onboardingReducer(competition, { type: "back" }).step).toBe(
      "choose-extra",
    );
  });

  test("done → choose-extra via goto, back returns to done", () => {
    const done: OnboardingState = { step: "done", selectedGuildId: "g" };
    const choose = onboardingReducer(done, {
      type: "goto",
      step: "choose-extra",
    });
    expect(choose.step).toBe("choose-extra");
    expect(onboardingReducer(choose, { type: "back" }).step).toBe("done");
  });
});

describe("progressStep", () => {
  test("maps each step into 5 slots", () => {
    expect(progressStep("install")).toBe(1);
    expect(progressStep("pick-guild")).toBe(1);
    expect(progressStep("concepts")).toBe(2);
    expect(progressStep("subscribe-self")).toBe(3);
    expect(progressStep("subscribe-more")).toBe(4);
    expect(progressStep("done")).toBe(5);
    expect(progressStep("choose-extra")).toBe(5);
    expect(progressStep("build-report")).toBe(5);
    expect(progressStep("build-competition")).toBe(5);
  });
});
