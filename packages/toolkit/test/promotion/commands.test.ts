import { describe, expect, it } from "vitest";
import { promotionInvocation } from "#handlers/promotion.ts";

describe("promotion operator commands", () => {
  it("uses one stable target workflow ID and refuses to replace an active execution", () => {
    const command = promotionInvocation("run", "pmc", true);
    expect(command).toContain("storm-promotion/pmc");
    expect(command).toContain("Fail");
    expect(command).toContain('{"targetId":"pmc","mode":"run"}');
  });
  it("separates non-publishing previews/reconciliation and rejects ambiguous targets", () => {
    expect(promotionInvocation("preview", "reddit-mcservers", false)).toContain(
      '{"targetId":"reddit-mcservers","mode":"preview"}',
    );
    expect(() => promotionInvocation("run", undefined, false)).toThrow(
      "requires a target",
    );
    expect(() => promotionInvocation("run", "../all", false)).toThrow("exact");
    expect(() => promotionInvocation("unknown", undefined, false)).toThrow(
      "Unknown",
    );
  });
});
