import { describe, expect, it } from "bun:test";
import {
  ACTIVE_EXPERIMENTS,
  assignVariant,
  ExperimentSchema,
  findActiveExperiment,
} from "./variant.ts";

const balanced = ExperimentSchema.parse({
  id: "balanced-test",
  arms: [
    { id: "control", weight: 1 },
    { id: "treatment", weight: 1 },
  ],
});

const weighted = ExperimentSchema.parse({
  id: "weighted-test",
  arms: [
    { id: "control", weight: 3 },
    { id: "treatment", weight: 1 },
  ],
});

describe("assignVariant", () => {
  it("returns the same arm for the same (experiment, repo, author) tuple", () => {
    const a = assignVariant({
      experiment: balanced,
      repo: "owner/repo",
      author: "alice",
    });
    const b = assignVariant({
      experiment: balanced,
      repo: "owner/repo",
      author: "alice",
    });
    expect(a).toEqual(b);
  });

  it("returns one of the configured arms", () => {
    const a = assignVariant({
      experiment: balanced,
      repo: "x/y",
      author: "z",
    });
    expect(["control", "treatment"]).toContain(a.variant);
    expect(a.experimentId).toBe("balanced-test");
  });

  it("distributes roughly evenly across many authors for a 1:1 split", () => {
    let control = 0;
    let treatment = 0;
    for (let i = 0; i < 10_000; i++) {
      const r = assignVariant({
        experiment: balanced,
        repo: "owner/repo",
        author: `user-${String(i)}`,
      });
      if (r.variant === "control") control++;
      else treatment++;
    }
    // Each side should be within ~3σ of 5000 (σ ≈ 50 for Bernoulli n=10k).
    // Use a generous 200-count tolerance to avoid flaky tests.
    expect(Math.abs(control - 5000)).toBeLessThan(200);
    expect(Math.abs(treatment - 5000)).toBeLessThan(200);
  });

  it("respects weight ratios for non-uniform splits", () => {
    let control = 0;
    let treatment = 0;
    for (let i = 0; i < 10_000; i++) {
      const r = assignVariant({
        experiment: weighted,
        repo: "owner/repo",
        author: `user-${String(i)}`,
      });
      if (r.variant === "control") control++;
      else treatment++;
    }
    // 3:1 split → control ≈ 7500, treatment ≈ 2500.
    expect(Math.abs(control - 7500)).toBeLessThan(250);
    expect(Math.abs(treatment - 2500)).toBeLessThan(250);
  });

  it("changes assignment when experimentId changes (sticky on tuple, not on tuple-minus-experiment)", () => {
    const other = ExperimentSchema.parse({
      id: "other",
      arms: [
        { id: "control", weight: 1 },
        { id: "treatment", weight: 1 },
      ],
    });
    // Find an author who flips between balanced and other — must exist
    // because the two hashes are independent.
    let flipped = false;
    for (let i = 0; i < 100; i++) {
      const a = assignVariant({
        experiment: balanced,
        repo: "owner/repo",
        author: `u${String(i)}`,
      });
      const b = assignVariant({
        experiment: other,
        repo: "owner/repo",
        author: `u${String(i)}`,
      });
      if (a.variant !== b.variant) {
        flipped = true;
        break;
      }
    }
    expect(flipped).toBe(true);
  });
});

describe("findActiveExperiment", () => {
  it("returns the registered experiment by id", () => {
    const first = ACTIVE_EXPERIMENTS[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const found = findActiveExperiment(first.id);
    expect(found?.id).toBe(first.id);
  });

  it("returns undefined for an unknown id", () => {
    expect(findActiveExperiment("definitely-not-real")).toBeUndefined();
  });
});

describe("ExperimentSchema", () => {
  it("rejects experiments with fewer than 2 arms", () => {
    expect(() =>
      ExperimentSchema.parse({
        id: "solo",
        arms: [{ id: "only-arm", weight: 1 }],
      }),
    ).toThrow();
  });

  it("rejects non-kebab-case experiment ids", () => {
    expect(() =>
      ExperimentSchema.parse({
        id: "Has Spaces",
        arms: [
          { id: "a", weight: 1 },
          { id: "b", weight: 1 },
        ],
      }),
    ).toThrow();
  });

  it("rejects zero or negative weights", () => {
    expect(() =>
      ExperimentSchema.parse({
        id: "bad-weights",
        arms: [
          { id: "a", weight: 0 },
          { id: "b", weight: 1 },
        ],
      }),
    ).toThrow();
  });
});
