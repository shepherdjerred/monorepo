/**
 * Build the `claude -p` argv for a mutating babysitter iteration. Mirrors the
 * agent-task `claudeCommand` but grants WRITE tools (Edit/Write) in addition to
 * Bash (which already covers git) and uses the babysit output schema + prompt.
 *
 * `--json-schema` MUST be inline JSON, never a file path (claude wedges on a
 * path); the validated object comes back in the result message's
 * `structured_output` field.
 */
import { BABYSIT_ITERATION_OUTPUT_JSON_SCHEMA } from "#shared/pr-babysit/types.ts";

/** Bash covers git; Edit/Write let the agent change files. No network MCP. */
const BABYSIT_ALLOWED_TOOLS = "Bash,Read,Grep,Glob,Edit,Write,WebFetch";

export type BuildBabysitCommandInput = {
  prompt: string;
  workdir: string;
  model: string;
  maxTurns: number;
};

export function buildBabysitIterationCommand(
  input: BuildBabysitCommandInput,
): string[] {
  return [
    "claude",
    "-p",
    input.prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--json-schema",
    JSON.stringify(BABYSIT_ITERATION_OUTPUT_JSON_SCHEMA),
    "--allowed-tools",
    BABYSIT_ALLOWED_TOOLS,
    "--permission-mode",
    "acceptEdits",
    "--dangerously-skip-permissions",
    "--add-dir",
    input.workdir,
    "--max-turns",
    String(input.maxTurns),
    "--model",
    input.model,
  ];
}
