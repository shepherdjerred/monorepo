import { describe, test, expect } from "bun:test";
import { parseReflectionResponse } from "#lib/ai/reflection.ts";

describe("parseReflectionResponse", () => {
  test("parses valid JSON array of reflections", () => {
    const response = JSON.stringify([
      {
        type: "observation",
        content: "Candidate is using brute force",
        priority: 5,
      },
      {
        type: "suggestion",
        content: "Consider hinting at hash map",
        priority: 3,
      },
    ]);

    const reflections = parseReflectionResponse(response);
    expect(reflections).toHaveLength(2);
    expect(reflections[0]?.type).toBe("observation");
    expect(reflections[0]?.content).toBe("Candidate is using brute force");
    expect(reflections[0]?.priority).toBe(5);
    expect(reflections[0]?.createdAt).toBeGreaterThan(0);
    expect(reflections[1]?.type).toBe("suggestion");
  });

  test("parses next_move reflections", () => {
    const response = JSON.stringify([
      {
        type: "next_move",
        content: "All tests pass. Ready for part 2.",
        priority: 9,
        nextMove: {
          action: "reveal_next_part",
          targetPart: 2,
          condition: "immediate",
        },
      },
    ]);

    const reflections = parseReflectionResponse(response);
    expect(reflections).toHaveLength(1);
    expect(reflections[0]?.nextMove?.action).toBe("reveal_next_part");
    expect(reflections[0]?.nextMove?.targetPart).toBe(2);
    expect(reflections[0]?.nextMove?.condition).toBe("immediate");
  });

  test("handles JSON wrapped in markdown code fences", () => {
    const response = `Here is my analysis:
\`\`\`json
[{"type": "observation", "content": "Good progress", "priority": 4}]
\`\`\``;

    const reflections = parseReflectionResponse(response);
    expect(reflections).toHaveLength(1);
    expect(reflections[0]?.content).toBe("Good progress");
  });

  test("returns empty array for no JSON found", () => {
    const reflections = parseReflectionResponse(
      "No useful analysis to provide.",
    );
    expect(reflections).toHaveLength(0);
  });

  test("returns empty array for invalid JSON", () => {
    const reflections = parseReflectionResponse("[invalid json}");
    expect(reflections).toHaveLength(0);
  });

  test("returns empty array for array with invalid schema", () => {
    const response = JSON.stringify([
      { type: "invalid_type", content: 123, priority: "not a number" },
    ]);
    const reflections = parseReflectionResponse(response);
    expect(reflections).toHaveLength(0);
  });

  test("handles nextMove without targetPart", () => {
    const response = JSON.stringify([
      {
        type: "next_move",
        content: "Time to wrap up",
        priority: 8,
        nextMove: {
          action: "wrap_up",
          condition: "after_response",
        },
      },
    ]);

    const reflections = parseReflectionResponse(response);
    expect(reflections).toHaveLength(1);
    expect(reflections[0]?.nextMove?.action).toBe("wrap_up");
    expect(reflections[0]?.nextMove?.targetPart).toBeUndefined();
  });

  test("handles empty array", () => {
    const reflections = parseReflectionResponse("[]");
    expect(reflections).toHaveLength(0);
  });
});
