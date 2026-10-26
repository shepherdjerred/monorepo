import { describe, expect, it, vi } from "vitest";
import {
  handlePromotionCommand,
  promotionInvocation,
} from "#handlers/promotion.ts";

describe("promotion operator commands", () => {
  it("prints a non-mutating preview and forwards the real invocation without wrapper flags", async () => {
    const run = vi
        .fn<(args: string[]) => Promise<number>>()
        .mockResolvedValue(0),
      write = vi.fn();
    await handlePromotionCommand("preview", ["pmc", "--json", "--dry-run"], {
      run,
      write,
    });
    expect(run).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining('"command": "toolkit"'),
    );
    await handlePromotionCommand("preview", ["pmc", "--json"], { run, write });
    expect(run).toHaveBeenCalledExactlyOnceWith([
      "toolkit",
      ...promotionInvocation("preview", "pmc", true),
    ]);
  });
  it("reports native failure and rejects extra positional arguments before starting work", async () => {
    const run = vi
        .fn<(args: string[]) => Promise<number>>()
        .mockResolvedValue(9),
      write = vi.fn();
    await expect(
      handlePromotionCommand("run", ["pmc"], { run, write }),
    ).rejects.toThrow("failed (9)");
    run.mockClear();
    await expect(
      handlePromotionCommand("run", ["pmc", "other"], { run, write }),
    ).rejects.toThrow("toolkit promotion");
    expect(run).not.toHaveBeenCalled();
  });
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
