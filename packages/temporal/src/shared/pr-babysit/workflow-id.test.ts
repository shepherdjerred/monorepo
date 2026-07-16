import { describe, expect, test } from "bun:test";
import { prBabysitWorkflowId } from "./workflow-id.ts";

describe("prBabysitWorkflowId", () => {
  test("stable, sanitized, one per PR", () => {
    expect(prBabysitWorkflowId("shepherdjerred", "monorepo", 1334)).toBe(
      "pr-babysit-shepherdjerred-monorepo-1334",
    );
  });
  test("sanitizes unsafe characters", () => {
    const id = prBabysitWorkflowId("Owner/X", "re po", 7);
    expect(id).toBe("pr-babysit-owner-x-re-po-7");
  });
  test("same inputs → same id (idempotent)", () => {
    expect(prBabysitWorkflowId("a", "b", 1)).toBe(
      prBabysitWorkflowId("a", "b", 1),
    );
  });
});
