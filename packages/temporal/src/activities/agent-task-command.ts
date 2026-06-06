import {
  AGENT_TASK_OUTPUT_JSON_SCHEMA,
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
};

export function reportOnlyPrompt(
  input: AgentTaskInput,
  workdir: string,
): string {
  const runtimeLines =
    input.agentTimeoutMinutes === undefined
      ? []
      : [
          `Runtime budget: ${String(input.agentTimeoutMinutes)} minutes.`,
          "- Keep every shell command narrowly scoped and time-bounded; use the `timeout` command when available.",
          "- If a command is slow or would exceed the budget, stop that section, mark it Skipped or Failed, and return the partial report.",
          "",
        ];
  const sourceLines =
    input.source === undefined
      ? []
      : [
          "Source context:",
          input.source.docPath === undefined
            ? undefined
            : `- docPath: ${input.source.docPath}`,
          input.source.url === undefined
            ? undefined
            : `- url: ${input.source.url}`,
          input.source.note === undefined
            ? undefined
            : `- note: ${input.source.note}`,
          "",
        ].filter((line) => line !== undefined);

  return [
    "You are running as a delayed Temporal agent task.",
    "",
    "Hard constraints:",
    "- This task is report-only.",
    "- Do not edit files, commit, push, open pull requests, open issues, or mutate live systems.",
    "- You may inspect the checked-out repository and query read-only operational tools when the prompt requires current state.",
    "- Revalidate the source context first; if the task is already resolved, report that clearly.",
    "- If a recurring schedule is no longer useful, set cancelCron=true and explain why in cancelReason.",
    "- If one future report-only follow-up is needed, set followUp with either runAt or cron.",
    "- Return only JSON matching the provided schema.",
    "",
    ...runtimeLines,
    `Task title: ${input.title}`,
    `Repository workdir: ${workdir}`,
    "",
    ...sourceLines,
    "User prompt:",
    input.prompt,
  ].join("\n");
}

async function writeOutputSchema(path: string): Promise<void> {
  await Bun.write(path, JSON.stringify(AGENT_TASK_OUTPUT_JSON_SCHEMA, null, 2));
}

async function claudeCommand(
  input: AgentTaskInput,
  workdir: string,
): Promise<AgentTaskCommand> {
  const token = Bun.env["CLAUDE_CODE_OAUTH_TOKEN"];
  if (token === undefined || token === "") {
    throw new Error(
      "CLAUDE_CODE_OAUTH_TOKEN is required for Claude agent tasks",
    );
  }
  const schemaPath = `${workdir}/agent-task-output.schema.json`;
  await writeOutputSchema(schemaPath);
  const model = input.model ?? DEFAULT_CLAUDE_MODEL;
  const maxTurns = input.maxTurns ?? DEFAULT_MAX_TURNS;
  return {
    args: [
      "claude",
      "-p",
      reportOnlyPrompt(input, workdir),
      "--output-format",
      "json",
      "--json-schema",
      schemaPath,
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
      reportOnlyPrompt(input, workdir),
    ],
    model,
    outputPath,
  };
}

export async function buildAgentTaskCommand(
  input: AgentTaskInput,
  workdir: string,
): Promise<AgentTaskCommand> {
  return input.provider === "claude"
    ? await claudeCommand(input, workdir)
    : await codexCommand(input, workdir);
}

// Force CI rebuild
