import type {
  SessionModel,
  ClaudeModel,
  CodexModel,
  GeminiModel,
} from "@clauderon/client";
import { AgentType } from "@clauderon/shared";

type ModelOption = {
  value: SessionModel;
  label: string;
};

const CLAUDE_MODELS: ModelOption[] = [
  {
    value: { type: "Claude" as const, content: "Sonnet4_5" as ClaudeModel },
    label: "Sonnet 4.5 (Default - Balanced)",
  },
  {
    value: { type: "Claude" as const, content: "Opus4_5" as ClaudeModel },
    label: "Opus 4.5 (Most Capable)",
  },
  {
    value: { type: "Claude" as const, content: "Haiku4_5" as ClaudeModel },
    label: "Haiku 4.5 (Fastest)",
  },
  {
    value: { type: "Claude" as const, content: "Opus4_1" as ClaudeModel },
    label: "Opus 4.1 (Agentic)",
  },
  {
    value: { type: "Claude" as const, content: "Opus4" as ClaudeModel },
    label: "Opus 4",
  },
  {
    value: { type: "Claude" as const, content: "Sonnet4" as ClaudeModel },
    label: "Sonnet 4",
  },
];

const CODEX_MODELS: ModelOption[] = [
  {
    value: { type: "Codex" as const, content: "Gpt5_2Codex" as CodexModel },
    label: "GPT-5.2-Codex (Default - Best for Code)",
  },
  {
    value: { type: "Codex" as const, content: "Gpt5_2" as CodexModel },
    label: "GPT-5.2",
  },
  {
    value: { type: "Codex" as const, content: "Gpt5_2Instant" as CodexModel },
    label: "GPT-5.2 Instant (Fast)",
  },
  {
    value: {
      type: "Codex" as const,
      content: "Gpt5_2Thinking" as CodexModel,
    },
    label: "GPT-5.2 Thinking (Reasoning)",
  },
  {
    value: { type: "Codex" as const, content: "Gpt5_2Pro" as CodexModel },
    label: "GPT-5.2 Pro (Premium)",
  },
  {
    value: { type: "Codex" as const, content: "Gpt5_1" as CodexModel },
    label: "GPT-5.1",
  },
  {
    value: { type: "Codex" as const, content: "Gpt5_1Instant" as CodexModel },
    label: "GPT-5.1 Instant",
  },
  {
    value: {
      type: "Codex" as const,
      content: "Gpt5_1Thinking" as CodexModel,
    },
    label: "GPT-5.1 Thinking",
  },
  {
    value: { type: "Codex" as const, content: "Gpt4_1" as CodexModel },
    label: "GPT-4.1 (Coding Specialist)",
  },
  {
    value: { type: "Codex" as const, content: "O3Mini" as CodexModel },
    label: "o3-mini (Small Reasoning)",
  },
];

const GEMINI_MODELS: ModelOption[] = [
  {
    value: { type: "Gemini" as const, content: "Gemini3Pro" as GeminiModel },
    label: "Gemini 3 Pro (Default - 1M Context)",
  },
  {
    value: { type: "Gemini" as const, content: "Gemini3Flash" as GeminiModel },
    label: "Gemini 3 Flash (Fast)",
  },
  {
    value: { type: "Gemini" as const, content: "Gemini2_5Pro" as GeminiModel },
    label: "Gemini 2.5 Pro",
  },
  {
    value: {
      type: "Gemini" as const,
      content: "Gemini2_0Flash" as GeminiModel,
    },
    label: "Gemini 2.0 Flash",
  },
];

export function getModelsForAgent(agent: AgentType): ModelOption[] {
  switch (agent) {
    case AgentType.ClaudeCode:
      return CLAUDE_MODELS;
    case AgentType.Codex:
      return CODEX_MODELS;
    case AgentType.Gemini:
      return GEMINI_MODELS;
    default:
      return [];
  }
}

type RepositoryEntry = {
  id: string;
  repo_path: string;
  mount_name: string;
  is_primary: boolean;
  base_branch: string;
};

export function validateRepositories(
  repositories: RepositoryEntry[],
  multiRepoEnabled: boolean,
  backend: string,
): string | null {
  if (repositories.length === 0) {
    return "At least one repository is required";
  }

  // Single mode: Only first repo needs path
  if (!multiRepoEnabled) {
    if (
      repositories[0]?.repo_path.trim() == null ||
      repositories[0].repo_path.trim().length === 0
    ) {
      return "Repository path is required";
    }
    return null;
  }

  // Multi mode validation
  if (repositories.length < 2) {
    return "Multi-repository mode requires at least 2 repositories";
  }

  if (repositories.some((r) => !r.repo_path.trim())) {
    return "All repositories must have a path";
  }

  const primaryCount = repositories.filter((r) => r.is_primary).length;
  if (primaryCount !== 1) {
    return "Exactly one repository must be marked as primary";
  }

  const mountNameError = validateMountNames(repositories);
  if (mountNameError != null) {
    return mountNameError;
  }

  if (backend !== "Docker") {
    return "Multi-repository mode is only supported with Docker backend";
  }

  return null;
}

function validateMountNames(repositories: RepositoryEntry[]): string | null {
  const mountNames = new Set<string>();
  const reserved = new Set(["workspace", "clauderon", "repos", "primary"]);

  for (const repo of repositories) {
    const name = repo.mount_name.trim();

    if (!name) {
      return "All repositories must have a mount name";
    }

    if (!/^[a-z0-9](?:[a-z0-9-_]{0,62}[a-z0-9])?$/.test(name)) {
      return `Invalid mount name "${name}": must be alphanumeric with hyphens/underscores, 1-64 characters`;
    }

    if (mountNames.has(name)) {
      return `Duplicate mount name: "${name}"`;
    }

    if (reserved.has(name.toLowerCase())) {
      return `Mount name "${name}" is reserved`;
    }

    mountNames.add(name);
  }

  return null;
}
