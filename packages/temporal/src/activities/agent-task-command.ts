import {
  AGENT_TASK_OUTPUT_JSON_SCHEMA,
  reportOnlyPrompt,
  type AgentTaskInput,
} from "#shared/agent-task.ts";

const DEFAULT_CLAUDE_MODEL = "claude-opus-4-8";
const DEFAULT_CODEX_MODEL = "gpt-5.5";
const DEFAULT_MAX_TURNS = 80;
const CLAUDE_ALLOWED_TOOLS = "Bash,Read,Grep,Glob,WebFetch";

export type AgentTaskCommand = {
  args: string[];
  model: string;
  outputPath: string | undefined;
  /** The rendered prompt, exposed for the LLM-observability span bodies. */
  prompt: string;
};

async function writeOutputSchema(path: string): Promise<void> {
  await Bun.write(path, JSON.stringify(AGENT_TASK_OUTPUT_JSON_SCHEMA, null, 2));
}

// `--json-schema` MUST be the inline schema JSON, never a file path: claude
// wedges (zero output until killed) on a path, but works given the schema
// content inline. The validated object comes back in the result message's
// `structured_output` field (see parseAgentPayload). `stream-json --verbose`
// streams NDJSON so the run is observable line-by-line.
function claudeCommand(
  input: AgentTaskInput,
  workdir: string,
): AgentTaskCommand {
  const token = Bun.env["CLAUDE_CODE_OAUTH_TOKEN"];
  if (token === undefined || token === "") {
    throw new Error(
      "CLAUDE_CODE_OAUTH_TOKEN is required for Claude agent tasks",
    );
  }
  const model = input.model ?? DEFAULT_CLAUDE_MODEL;
  const maxTurns = input.maxTurns ?? DEFAULT_MAX_TURNS;
  const prompt = reportOnlyPrompt(input, workdir);
  return {
    args: [
      "claude",
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--json-schema",
      JSON.stringify(AGENT_TASK_OUTPUT_JSON_SCHEMA),
      "--allowed-tools",
      CLAUDE_ALLOWED_TOOLS,
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
): Promise<AgentTaskCommand> {
  const apiKey = Bun.env["OPENAI_API_KEY"];
  if (apiKey === undefined || apiKey === "") {
    throw new Error("OPENAI_API_KEY is required for Codex agent tasks");
  }
  const schemaPath = `${workdir}/agent-task-output.schema.json`;
  const outputPath = `${workdir}/agent-task-output.json`;
  await writeOutputSchema(schemaPath);
  const model = input.model ?? DEFAULT_CODEX_MODEL;
  const prompt = reportOnlyPrompt(input, workdir);
  return {
    args: [
      "codex",
      "exec",
      "--sandbox",
      "read-only",
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
): Promise<AgentTaskCommand> {
  return input.provider === "claude"
    ? claudeCommand(input, workdir)
    : await codexCommand(input, workdir);
}
