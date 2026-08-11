import {
  AGENT_TASK_OUTPUT_JSON_SCHEMA_CLAUDE,
  AGENT_TASK_OUTPUT_JSON_SCHEMA_CLAUDE_V2,
  AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX,
  AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX_V2,
  type AgentTaskInput,
} from "#shared/agent-task.ts";
import {
  reportOnlyPrompt,
  SINGLE_AGENT_TASK_PROMPT_PHASE,
  type AgentTaskPromptPhase,
} from "#shared/agent-task-prompt.ts";

const DEFAULT_CLAUDE_MODEL = "claude-opus-5";
const DEFAULT_CODEX_MODEL = "gpt-5.6-sol";
const DEFAULT_MAX_TURNS = 80;
const CLAUDE_ALLOWED_TOOLS = "Bash,Read,Grep,Glob,WebFetch";

// Claude Code versions before 2.1.205 could silently return an unstructured
// result when structured-output schema validation failed. Keep this contract
// next to the command construction so the image pin and tests share one floor.
export const CLAUDE_CODE_MINIMUM_VERSION = "2.1.205";
export const CLAUDE_CODE_PINNED_VERSION = "2.1.220";

export type AgentTaskCommand = {
  args: string[];
  model: string;
  outputPath: string | undefined;
  /** The rendered prompt, exposed for the LLM-observability span bodies. */
  prompt: string;
};

async function writeOutputSchema(
  path: string,
  schema: Record<string, unknown>,
): Promise<void> {
  await Bun.write(path, JSON.stringify(schema, null, 2));
}

// `--json-schema` MUST be the inline schema JSON, never a file path: claude
// wedges (zero output until killed) on a path, but works given the schema
// content inline. The validated object comes back in the result message's
// `structured_output` field (see parseAgentPayload). `stream-json --verbose`
// streams NDJSON so the run is observable line-by-line.
function claudeCommand(
  input: AgentTaskInput,
  workdir: string,
  phase: AgentTaskPromptPhase,
): AgentTaskCommand {
  const token = Bun.env["CLAUDE_CODE_OAUTH_TOKEN"];
  if (token === undefined || token === "") {
    throw new Error(
      "CLAUDE_CODE_OAUTH_TOKEN is required for Claude agent tasks",
    );
  }
  const model = input.model ?? DEFAULT_CLAUDE_MODEL;
  const maxTurns = input.maxTurns ?? DEFAULT_MAX_TURNS;
  const prompt = reportOnlyPrompt(input, workdir, phase);
  const outputSchema =
    input.contractVersion === 2
      ? AGENT_TASK_OUTPUT_JSON_SCHEMA_CLAUDE_V2
      : AGENT_TASK_OUTPUT_JSON_SCHEMA_CLAUDE;
  return {
    args: [
      "claude",
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--json-schema",
      JSON.stringify(outputSchema),
      ...(phase.kind === "finalization"
        ? ["--tools", ""]
        : ["--allowed-tools", CLAUDE_ALLOWED_TOOLS]),
      "--permission-mode",
      "acceptEdits",
      "--dangerously-skip-permissions",
      "--add-dir",
      workdir,
      "--max-turns",
      String(maxTurns),
      "--model",
      model,
    ],
    model,
    outputPath: undefined,
    prompt,
  };
}

async function codexCommand(
  input: AgentTaskInput,
  workdir: string,
  phase: AgentTaskPromptPhase,
): Promise<AgentTaskCommand> {
  const apiKey = Bun.env["CODEX_API_KEY"] ?? Bun.env["OPENAI_API_KEY"];
  if (apiKey === undefined || apiKey === "") {
    throw new Error(
      "CODEX_API_KEY or OPENAI_API_KEY is required for Codex agent tasks",
    );
  }
  const phaseSuffix = phase.kind === "single" ? "output" : phase.kind;
  const schemaPath = `${workdir}/agent-task-${phaseSuffix}.schema.json`;
  const outputPath = `${workdir}/agent-task-${phaseSuffix}.json`;
  await writeOutputSchema(
    schemaPath,
    input.contractVersion === 2
      ? AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX_V2
      : AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX,
  );
  const model = input.model ?? DEFAULT_CODEX_MODEL;
  const prompt = reportOnlyPrompt(input, workdir, phase);
  return {
    args: [
      "codex",
      "exec",
      // Codex's OS-level sandbox needs bwrap to create a Linux namespace, which
      // the unprivileged, non-root worker pod refuses ("No permissions to
      // create a new namespace"), so any --sandbox value other than
      // danger-full-access hard-fails before the first command runs. We drop the
      // OS sandbox; the isolation boundary is the ephemeral non-root pod, the
      // throwaway per-run clone, and report-only mode (the prompt forbids
      // mutation). The full worker env IS forwarded to the subprocess
      // (envForProvider, agent-task-env.ts) — an accepted risk documented there,
      // required so the report-only homelab audit keeps its read-only creds.
      "--sandbox",
      "danger-full-access",
      "--config",
      'approval_policy="never"',
      "--json",
      "--output-schema",
      schemaPath,
      "--output-last-message",
      outputPath,
      "--cd",
      workdir,
      "--model",
      model,
      prompt,
    ],
    model,
    outputPath,
    prompt,
  };
}

export async function buildAgentTaskCommand(
  input: AgentTaskInput,
  workdir: string,
  phase: AgentTaskPromptPhase = SINGLE_AGENT_TASK_PROMPT_PHASE,
): Promise<AgentTaskCommand> {
  return input.provider === "claude"
    ? claudeCommand(input, workdir, phase)
    : await codexCommand(input, workdir, phase);
}
