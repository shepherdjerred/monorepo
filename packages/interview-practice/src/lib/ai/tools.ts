import type { ToolDefinition } from "./client.ts";

export const RUN_TESTS_TOOL: ToolDefinition = {
  name: "run_tests",
  description:
    "Run the candidate's solution against the hidden test suite. Returns pass/fail counts and details for each test case. Tests are ALWAYS hidden from the candidate — you see the results but the candidate only sees the pass/fail count. You may hint at specific failing cases verbally (e.g., 'What about when the array has duplicates?') but NEVER reveal test inputs or expected outputs directly.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [],
  },
};

export const REVEAL_NEXT_PART_TOOL: ToolDefinition = {
  name: "reveal_next_part",
  description:
    "Advance the interview to the next part of the multi-part problem. Only call this when the candidate has met the transition criteria for the current part (working solution + complexity explanation if required). The candidate's problem.md file will be updated with the new part's description.",
  inputSchema: {
    type: "object" as const,
    properties: {
      reason: {
        type: "string",
        description:
          "Brief explanation of why advancing (e.g., 'Candidate solved optimally and explained complexity')",
      },
    },
    required: ["reason"],
  },
};

export const GIVE_HINT_TOOL: ToolDefinition = {
  name: "give_hint",
  description:
    "Provide a hint to the candidate. Use sparingly — hints reduce the scoring ceiling. Start with subtle hints and escalate only if the candidate is truly stuck (2+ turns with no progress). The hint text comes from the question bank; you frame it naturally in conversation.",
  inputSchema: {
    type: "object" as const,
    properties: {
      level: {
        type: "string",
        enum: ["subtle", "moderate", "explicit"],
        description:
          "Hint intensity. Start subtle, escalate only if needed.",
      },
    },
    required: ["level"],
  },
};

export function getLeetcodeTools(): ToolDefinition[] {
  return [RUN_TESTS_TOOL, REVEAL_NEXT_PART_TOOL, GIVE_HINT_TOOL];
}
