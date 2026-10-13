import { appendFile } from "node:fs/promises";
import { z } from "zod";

const SessionSchema = z
  .string()
  .min(1)
  .max(500)
  .regex(/^[\w-]+$/u);
const ClaudeHookSchema = z.object({
  session_id: SessionSchema,
  transcript_path: z.string().optional(),
});
const CursorHookSchema = z.object({
  conversation_id: SessionSchema,
  tool_name: z.literal("Shell"),
  tool_input: z.looseObject({ command: z.string() }),
  model: z.string().optional(),
});
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}
export function claudeIdentityExports(input: unknown): string {
  const event = ClaudeHookSchema.parse(input);
  return `export TRACKER_ACTOR_HARNESS='claude-code'\nexport CLAUDE_CODE_SESSION_ID=${shellQuote(event.session_id)}\n${event.transcript_path === undefined ? "" : `export CLAUDE_TRANSCRIPT_PATH=${shellQuote(event.transcript_path)}\n`}`;
}
export function cursorIdentityInput(input: unknown) {
  const event = CursorHookSchema.parse(input);
  const exports = [
    "export TRACKER_ACTOR_HARNESS='cursor'",
    `export CURSOR_CONVERSATION_ID=${shellQuote(event.conversation_id)}`,
  ];
  if (event.model !== undefined)
    exports.push(`export TRACKER_ACTOR_MODEL=${shellQuote(event.model)}`);
  return {
    updated_input: {
      ...event.tool_input,
      command: `${exports.join("\n")}\n${event.tool_input.command}`,
    },
  };
}
export async function identityHook(
  harness: string,
  input: unknown,
  environment: Readonly<Record<string, string | undefined>>,
) {
  if (harness === "cursor") return cursorIdentityInput(input);
  if (harness !== "claude-code")
    throw new Error("Identity hook supports claude-code or cursor");
  const destination = environment["CLAUDE_ENV_FILE"];
  if (destination === undefined || destination === "")
    throw new Error("SessionStart did not provide CLAUDE_ENV_FILE");
  await appendFile(destination, claudeIdentityExports(input));
  return {};
}
