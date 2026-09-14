import { describe, expect, test } from "vitest";

import type { LinearIssue } from "#src/domain/schemas.ts";
import {
  isEligibleIssue,
  providerForIssue,
  selectIssue,
} from "#src/integrations/linear.ts";

function issue(input: {
  identifier: string;
  priority?: number;
  createdAt?: string;
  labels?: string[];
  stateType?: string;
}): LinearIssue {
  return {
    id: input.identifier,
    identifier: input.identifier,
    title: input.identifier,
    description: null,
    url: `https://linear.app/example/issue/${input.identifier}`,
    priority: input.priority ?? 0,
    createdAt: input.createdAt ?? "2026-01-01T00:00:00.000Z",
    state: { name: "Todo", type: input.stateType ?? "unstarted" },
    labels: {
      nodes: (input.labels ?? ["agent:ready", "agent:codex"]).map((name) => ({
        name,
      })),
    },
  };
}

describe("Linear queue selection", () => {
  test("requires ready and exactly one provider", () => {
    expect(providerForIssue(issue({ identifier: "SJ-1" }))).toBe("codex");
    expect(
      isEligibleIssue(
        issue({
          identifier: "SJ-2",
          labels: ["agent:ready"],
        }),
      ),
    ).toBe(false);
    expect(
      isEligibleIssue(
        issue({
          identifier: "SJ-3",
          labels: ["agent:ready", "agent:codex", "agent:needs-human"],
        }),
      ),
    ).toBe(false);
  });

  test("chooses highest priority, then oldest", () => {
    expect(
      selectIssue([
        issue({ identifier: "SJ-1", priority: 3 }),
        issue({
          identifier: "SJ-2",
          priority: 1,
          createdAt: "2026-02-01T00:00:00.000Z",
        }),
        issue({
          identifier: "SJ-3",
          priority: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
        }),
      ])?.identifier,
    ).toBe("SJ-3");
  });
});
