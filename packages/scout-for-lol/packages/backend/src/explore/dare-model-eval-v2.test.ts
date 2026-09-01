import { describe, expect, test } from "vitest";
import { resolveDareModelEvalTargets } from "#src/explore/dare-model-eval-v2.ts";

const TARGET_ALIASES = { T1: "Virmel", T2: "Bryan" };

describe("Dare v2 model eval target resolution", () => {
  test("uses the target keys emitted by the model", () => {
    const resolved = resolveDareModelEvalTargets({
      targetKeys: ["T1"],
      targetAliases: TARGET_ALIASES,
    });

    expect(resolved.targets.map((target) => target.key)).toEqual(["T1"]);
    expect(resolved.issues).toContain(
      "Emitted target keys drifted from the expected frozen targets.",
    );
  });

  test("accepts the exact frozen target binding sequence", () => {
    const resolved = resolveDareModelEvalTargets({
      targetKeys: ["T1", "T2"],
      targetAliases: TARGET_ALIASES,
    });

    expect(resolved.targets.map((target) => target.key)).toEqual(["T1", "T2"]);
    expect(resolved.issues).toEqual([]);
  });

  test("rejects duplicate and unavailable emitted target keys", () => {
    const resolved = resolveDareModelEvalTargets({
      targetKeys: ["T3", "T3"],
      targetAliases: TARGET_ALIASES,
    });

    expect(resolved.targets).toEqual([]);
    expect(resolved.issues).toEqual([
      "Emitted target keys contain duplicates.",
      "Emitted target keys drifted from the expected frozen targets.",
      "Emitted target key T3 is not available.",
      "Emitted target key T3 is not available.",
    ]);
  });
});
