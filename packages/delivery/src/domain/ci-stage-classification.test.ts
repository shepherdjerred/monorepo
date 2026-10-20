import { describe, expect, it } from "vitest";
import { ciStage, woodpeckerStatus } from "./ci-stage-classification.ts";

describe("CI stage classification", () => {
  it("places known lanes and leaves new ones under other", () => {
    expect(ciStage("verify")).toBe("test");
    expect(ciStage("images")).toBe("build");
    expect(ciStage("delivery-publish")).toBe("publish");
    expect(ciStage("brand-new-lane")).toBe("other");
  });

  it("maps Woodpecker states and rejects unknown ones", () => {
    expect(woodpeckerStatus("success")).toBe("succeeded");
    expect(woodpeckerStatus("killed")).toBe("failed");
    expect(woodpeckerStatus("blocked")).toBe("awaiting_approval");
    expect(() => woodpeckerStatus("teleported")).toThrow();
  });
});
