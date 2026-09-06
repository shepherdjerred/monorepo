import {
  AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX,
  AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX_V2,
  type AgentTaskInput,
} from "#shared/agent/agent-task.ts";
import {
  reportOnlyPrompt,
  SINGLE_AGENT_TASK_PROMPT_PHASE,
  type AgentTaskPromptPhase,
} from "#shared/agent/agent-task-prompt.ts";
import { jsonSchemaFingerprint } from "#shared/agent/agent-task-json-schema.ts";

const DEFAULT_CODEX_MODEL = "gpt-5.6-luna";
const DEFAULT_MAX_TURNS = 80;

export const AGENT_ALLOWED_TOOLS = [
  "Bash",
  "Read",
  "Grep",
  "Glob",
  "WebFetch",
] as const;

export type AgentTaskSdkConfig = {
  provider: AgentTaskInput["provider"];
  phase: AgentTaskPromptPhase["kind"];
  model: string;
  prompt: string;
  workdir: string;
  maxTurns: number;
  contractVersion: 1 | 2;
  outputSchema: Record<string, unknown>;
  schemaFingerprint: string;
  allowedTools: readonly string[];
};

function outputSchema(input: AgentTaskInput): Record<string, unknown> {
  if (input.provider === "claude") {
    throw new Error(
      "Legacy Claude agent tasks can be decoded for replay but cannot execute after the OpenRouter migration",
    );
  }
  return input.contractVersion === 2
    ? AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX_V2
    : AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX;
}

export function buildAgentTaskSdkConfig(
  input: AgentTaskInput,
  workdir: string,
  phase: AgentTaskPromptPhase = SINGLE_AGENT_TASK_PROMPT_PHASE,
): AgentTaskSdkConfig {
  const model = input.model ?? DEFAULT_CODEX_MODEL;
  const schema = outputSchema(input);
  return {
    provider: input.provider,
    phase: phase.kind,
    model,
    prompt: reportOnlyPrompt(input, workdir, phase),
    workdir,
    maxTurns: input.maxTurns ?? DEFAULT_MAX_TURNS,
    contractVersion: input.contractVersion === 2 ? 2 : 1,
    outputSchema: schema,
    schemaFingerprint: jsonSchemaFingerprint(schema),
    // Finalization may only reason over the already-captured evidence catalog,
    // so the agent runs with no tools at all. Anything it could still discover
    // would be evidence that never passed a declared collector.
    allowedTools: phase.kind === "finalization" ? [] : AGENT_ALLOWED_TOOLS,
  };
}
