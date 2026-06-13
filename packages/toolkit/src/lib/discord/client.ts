import type { z } from "zod";
import {
  ErrorResponseSchema,
  pathExists,
  SOCKET_PATH,
} from "#lib/discord/ipc.ts";

const START_HINT = [
  "Discord daemon is not running. Start it with tokens in env (one batched op call):",
  "",
  '  bash -c \'J=$(op item get <ITEM> --vault "<VAULT>" --format json --reveal) \\',
  '    && export DISCORD_BOT_TOKEN=$(echo "$J" | jq -r ".fields[]|select((.label//.id)==\\"<BOT_FIELD>\\").value") \\',
  '    && export DISCORD_USER_TOKEN=$(echo "$J" | jq -r ".fields[]|select((.label//.id)==\\"<USER_FIELD>\\").value") \\',
  "    && toolkit discord daemon start'",
  "",
  "Ask the user which 1Password item/fields hold the right tokens.",
].join("\n");

export async function daemonRequest<Schema extends z.ZodType>(
  schema: Schema,
  path: string,
  body?: unknown,
): Promise<z.infer<Schema>> {
  if (!(await pathExists(SOCKET_PATH))) {
    throw new Error(START_HINT);
  }
  let response: Response;
  try {
    response = await fetch(`http://daemon${path}`, {
      unix: SOCKET_PATH,
      method: body === undefined ? "GET" : "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not reach the Discord daemon (${message}). The socket file exists but the daemon may have died — run 'toolkit discord daemon stop' to clean up, then start it again.\n\n${START_HINT}`,
      { cause: error },
    );
  }
  const json: unknown = await response.json();
  if (!response.ok) {
    const parsed = ErrorResponseSchema.safeParse(json);
    throw new Error(
      parsed.success
        ? `Daemon error: ${parsed.data.error}`
        : `Daemon error (HTTP ${String(response.status)})`,
    );
  }
  return schema.parse(json);
}
