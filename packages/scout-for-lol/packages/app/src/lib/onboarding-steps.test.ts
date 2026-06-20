import { describe, expect, test } from "bun:test";
import {
  initialOnboardingState,
  onboardingReducer,
  progressStep,
  type OnboardingState,
  type OnboardingStepKind,
} from "#src/lib/onboarding-steps.ts";

function state(
  step: OnboardingStepKind,
  selectedGuildId: string | null = "g",
  conceptsBack: OnboardingStepKind = "install",
): OnboardingState {
  return { step, selectedGuildId, selectedExampleId: null, conceptsBack };
}

describe("onboardingReducer", () => {
  test("starts on install with no guild", () => {
    expect(initialOnboardingState).toEqual({
      step: "install",
      selectedGuildId: null,
      selectedExampleId: null,
      conceptsBack: "install",
    });
  });

  test("select-guild from install sets the guild and jumps to concepts", () => {
    const next = onboardingReducer(initialOnboardingState, {
      type: "select-guild",
      guildId: "guild-123",
    });
    expect(next).toEqual({
      step: "concepts",
      selectedGuildId: "guild-123",
      selectedExampleId: null,
      // Single-guild path skips pick-guild, so concepts backs to install.
      conceptsBack: "install",
    });
  });

  test("multi-guild: back from concepts returns to pick-guild", () => {
    const picking = onboardingReducer(initialOnboardingState, {
      type: "goto",
      step: "pick-guild",
    });
    expect(picking.step).toBe("pick-guild");
    const concepts = onboardingReducer(picking, {
      type: "select-guild",
      guildId: "guild-abc",
    });
    expect(concepts.step).toBe("concepts");
    expect(concepts.conceptsBack).toBe("pick-guild");
    const back = onboardingReducer(concepts, { type: "back" });
    expect(back.step).toBe("pick-guild");
  });

  test("single-guild: back from concepts returns to install", () => {
    const concepts = onboardingReducer(initialOnboardingState, {
      type: "select-guild",
      guildId: "guild-only",
    });
    expect(concepts.step).toBe("concepts");
    const back = onboardingReducer(concepts, { type: "back" });
    expect(back.step).toBe("install");
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
    const a = onboardingReducer(state("concepts"), { type: "next" });
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
    let current: OnboardingState = state("done");
    for (const expected of steps) {
      current = onboardingReducer(current, { type: "back" });
      expect(current.step).toBe(expected);
    }
  });

  test("install next is a no-op (advances via select-guild)", () => {
    const next = onboardingReducer(initialOnboardingState, { type: "next" });
    expect(next).toEqual(initialOnboardingState);
  });

  test("choose routes to the build step and records the example", () => {
    const fromChoose = state("choose-extra");
    const report = onboardingReducer(fromChoose, {
      type: "choose",
      extra: "report",
      exampleId: "surrender",
    });
    expect(report.step).toBe("build-report");
    expect(report.selectedExampleId).toBe("surrender");
    const competition = onboardingReducer(fromChoose, {
      type: "choose",
      extra: "competition",
      exampleId: "yuumi",
    });
    expect(competition.step).toBe("build-competition");
    expect(competition.selectedExampleId).toBe("yuumi");
  });

  test("build steps go back to choose-extra", () => {
    expect(
      onboardingReducer(state("build-report"), { type: "back" }).step,
    ).toBe("choose-extra");
    expect(
      onboardingReducer(state("build-competition"), { type: "back" }).step,
    ).toBe("choose-extra");
  });

  test("done → choose-extra via goto, back returns to done", () => {
    const choose = onboardingReducer(state("done"), {
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
