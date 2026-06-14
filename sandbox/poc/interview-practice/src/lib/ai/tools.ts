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
        description: "Hint intensity. Start subtle, escalate only if needed.",
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

export const VIEW_CODE_TOOL: ToolDefinition = {
  name: "view_code",
  description:
    "Read the candidate's current solution file. Returns the full source code. Use proactively to check for bugs, or when the candidate mentions they've made changes.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [],
  },
};

export const EDIT_CODE_TOOL: ToolDefinition = {
  name: "edit_code",
  description:
    "Edit the candidate's solution file. Use for hints (add comments/skeleton code) or debugging help (fix specific bugs). The candidate will see changes in their editor. Specify either 'fullContent' to replace the entire file, or 'search' and 'replace' for a targeted edit.",
  inputSchema: {
    type: "object" as const,
    properties: {
      fullContent: {
        type: "string",
        description: "Full replacement content for the file",
      },
      search: {
        type: "string",
        description: "Text to search for (for targeted edit)",
      },
      replace: {
        type: "string",
        description: "Replacement text",
      },
      reason: {
        type: "string",
        description: "Why you're editing (hint, debug fix, skeleton)",
      },
    },
    required: ["reason"],
  },
};

export const HELP_DEBUG_TOOL: ToolDefinition = {
  name: "help_debug",
  description:
    "Help the candidate debug their solution. Choose a level and method. Subtle: hint at the area ('Look closely at your loop condition'). Moderate: point to specific line/issue ('Your base case doesn't handle empty input'). Explicit: fix the bug directly via code edit.",
  inputSchema: {
    type: "object" as const,
    properties: {
      level: {
        type: "string",
        enum: ["subtle", "moderate", "explicit"],
        description:
          "Debug help intensity. Start subtle, escalate only if needed.",
      },
      method: {
        type: "string",
        enum: ["verbal", "code_edit"],
        description: "Whether to help via speech or by editing the file",
      },
      description: {
        type: "string",
        description: "What the bug is and how you're helping",
      },
      codeEdit: {
        type: "object",
        properties: {
          search: { type: "string" },
          replace: { type: "string" },
        },
        description: "If method is code_edit, the search/replace to apply",
      },
    },
    required: ["level", "method", "description"],
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
  return [
    RUN_TESTS_TOOL,
    REVEAL_NEXT_PART_TOOL,
    GIVE_HINT_TOOL,
    PAUSE_AND_THINK_TOOL,
    VIEW_CODE_TOOL,
    EDIT_CODE_TOOL,
    HELP_DEBUG_TOOL,
  ];
}

export function getSystemDesignTools(): ToolDefinition[] {
  return [
    TRANSITION_PHASE_TOOL,
    REVIEW_DIAGRAM_TOOL,
    GIVE_HINT_TOOL,
    PAUSE_AND_THINK_TOOL,
  ];
}
