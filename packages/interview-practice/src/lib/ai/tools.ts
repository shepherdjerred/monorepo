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

export const PAUSE_AND_THINK_TOOL: ToolDefinition = {
  name: "pause_and_think",
  description:
    "Pause the conversation to think deeply about the candidate's progress. This triggers the reflection model for a thorough synchronous analysis before you respond. Use this when the candidate asks a complex question, when you're unsure whether to advance to the next part, or when you need to reassess strategy. Shows 'Let me think about that...' to the candidate.",
  inputSchema: {
    type: "object" as const,
    properties: {
      reason: {
        type: "string",
        description:
          "Why you need to pause and think (e.g., 'Candidate asked about optimization, need to assess if brute force is complete')",
      },
    },
    required: ["reason"],
  },
};

export const TRANSITION_PHASE_TOOL: ToolDefinition = {
  name: "transition_phase",
  description:
    "Transition the system design interview to the next phase. Only call this when the candidate has sufficiently covered the current phase. Phases progress in order: requirements → estimation → api-design → data-model → high-level → deep-dive → trade-offs.",
  inputSchema: {
    type: "object" as const,
    properties: {
      nextPhase: {
        type: "string",
        enum: [
          "requirements",
          "estimation",
          "api-design",
          "data-model",
          "high-level",
          "deep-dive",
          "trade-offs",
        ],
        description: "The phase to transition to.",
      },
      reason: {
        type: "string",
        description:
          "Brief explanation of why transitioning (e.g., 'Candidate covered all key requirements')",
      },
    },
    required: ["nextPhase", "reason"],
  },
};

export const REVIEW_DIAGRAM_TOOL: ToolDefinition = {
  name: "review_diagram",
  description:
    "Review the candidate's current system design diagram. Returns a semantic summary of the diagram's components and connections. Use this when the candidate mentions updating their diagram or when you want to check their architectural progress.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [],
  },
};

export function getLeetcodeTools(): ToolDefinition[] {
  return [RUN_TESTS_TOOL, REVEAL_NEXT_PART_TOOL, GIVE_HINT_TOOL, PAUSE_AND_THINK_TOOL];
}

export function getSystemDesignTools(): ToolDefinition[] {
  return [TRANSITION_PHASE_TOOL, REVIEW_DIAGRAM_TOOL, GIVE_HINT_TOOL, PAUSE_AND_THINK_TOOL];
}
