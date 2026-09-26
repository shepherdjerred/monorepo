import { describe, expect, test } from "vitest";
import { z } from "zod";

import { AgentOutputSchema } from "#src/domain/schemas.ts";

function stringFormats(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) stringFormats(item, found);
  } else if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (key === "format" && typeof entry === "string") found.push(entry);
      else stringFormats(entry, found);
    }
  }
  return found;
}

const VALID_OUTPUT = {
  status: "changed",
  commitTitle: "fix(git-spice): pass an explicit merge method",
  summary: "summary",
  verification: ["bun test"],
  resolvedFindingKeys: [],
  visualTargets: [],
};

describe("Agent output schema", () => {
  test("emits no string formats for structured-output providers", () => {
    expect(stringFormats(z.toJSONSchema(AgentOutputSchema))).toEqual([]);
  });

  test("routes must start with a slash", () => {
    expect(
      AgentOutputSchema.parse({
        ...VALID_OUTPUT,
        visualTargets: [{ package: "x", route: "/y", name: "z" }],
      }).visualTargets,
    ).toHaveLength(1);
    expect(() =>
      AgentOutputSchema.parse({
        ...VALID_OUTPUT,
        visualTargets: [{ package: "x", route: "y", name: "z" }],
      }),
    ).toThrow();
  });
});
