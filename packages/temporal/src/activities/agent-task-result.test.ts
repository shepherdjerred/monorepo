import { describe, expect, test } from "bun:test";
import { redactAgentTaskPayloadStrings } from "./agent-task-result.ts";

describe("agent task result redaction", () => {
  test("redacts secrets recursively before finalization or delivery", () => {
    const secret = "sensitive-provider-token";
    const redacted = redactAgentTaskPayloadStrings(
      {
        headline: `Observed ${secret}`,
        checks: [
          {
            summary: `Command returned ${secret}`,
            nested: { detail: secret },
          },
        ],
      },
      (value) => value.replaceAll(secret, "***"),
    );

    expect(JSON.stringify(redacted)).not.toContain(secret);
    expect(redacted).toEqual({
      headline: "Observed ***",
      checks: [
        {
          summary: "Command returned ***",
          nested: { detail: "***" },
        },
      ],
    });
  });
});
