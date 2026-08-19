import type { SessionModel } from "@clauderon/client";
import {
  AgentType,
  ClaudeModel,
  CodexModel,
  GeminiModel,
} from "@clauderon/shared";

type ModelOption = {
  value: SessionModel;
  label: string;
};

const CLAUDE_MODELS: ModelOption[] = [
  {
    value: { type: "Claude", content: ClaudeModel.Sonnet4_6 },
    label: "Sonnet 4.6 (Default - Balanced, 1M Context)",
  },
  {
    value: { type: "Claude", content: ClaudeModel.Opus4_6 },
    label: "Opus 4.6 (Most Capable, 1M Context)",
  },
  {
    value: { type: "Claude", content: ClaudeModel.Haiku4_5 },
    label: "Haiku 4.5 (Fastest)",
  },
  {
    value: { type: "Claude", content: ClaudeModel.Opus4_5 },
    label: "Opus 4.5",
  },
  {
    value: { type: "Claude", content: ClaudeModel.Sonnet4_5 },
    label: "Sonnet 4.5",
  },
  {
    value: { type: "Claude", content: ClaudeModel.Opus4_1 },
    label: "Opus 4.1 (Agentic)",
  },
  {
    value: { type: "Claude", content: ClaudeModel.Opus4 },
    label: "Opus 4",
  },
  {
    value: { type: "Claude", content: ClaudeModel.Sonnet4 },
    label: "Sonnet 4",
  },
];

const CODEX_MODELS: ModelOption[] = [
  {
    value: { type: "Codex", content: CodexModel.Gpt5_3Codex },
    label: "GPT-5.3-Codex (Default - Agentic Coding)",
  },
  {
    value: { type: "Codex", content: CodexModel.Gpt5_4 },
    label: "GPT-5.4 (Flagship)",
  },
  {
    value: { type: "Codex", content: CodexModel.Gpt5_4Mini },
    label: "GPT-5.4 Mini (Fast)",
  },
  {
    value: { type: "Codex", content: CodexModel.Gpt5_4Nano },
    label: "GPT-5.4 Nano (Cost-Effective)",
  },
  {
    value: { type: "Codex", content: CodexModel.Gpt5_4Pro },
    label: "GPT-5.4 Pro (Premium)",
  },
  {
    value: { type: "Codex", content: CodexModel.O3 },
    label: "o3 (Reasoning)",
  },
  {
    value: { type: "Codex", content: CodexModel.O3Pro },
    label: "o3-pro (Premium Reasoning)",
  },
  {
    value: { type: "Codex", content: CodexModel.O4Mini },
    label: "o4-mini (Fast Reasoning)",
  },
  {
    value: { type: "Codex", content: CodexModel.O3Mini },
    label: "o3-mini (Small Reasoning)",
  },
];

const GEMINI_MODELS: ModelOption[] = [
  {
    value: { type: "Gemini", content: GeminiModel.Gemini3_1Pro },
    label: "Gemini 3.1 Pro (Default - 1M Context)",
  },
  {
    value: { type: "Gemini", content: GeminiModel.Gemini3Flash },
    label: "Gemini 3 Flash (Fast)",
  },
  {
    value: { type: "Gemini", content: GeminiModel.Gemini3_1FlashLite },
    label: "Gemini 3.1 Flash-Lite (Cost-Effective)",
  },
  {
    value: { type: "Gemini", content: GeminiModel.Gemini2_5Pro },
    label: "Gemini 2.5 Pro",
  },
  {
    value: { type: "Gemini", content: GeminiModel.Gemini2_5Flash },
    label: "Gemini 2.5 Flash",
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
