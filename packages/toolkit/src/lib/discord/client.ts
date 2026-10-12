import type { z } from "zod";
import { pathExists } from "@shepherdjerred/unix-socket-daemon";
import { ErrorResponseSchema, SOCKET_PATH } from "#lib/discord/ipc.ts";

const START_HINT = [
  "Discord daemon is not running. toolkit resolves DISCORD_BOT_TOKEN / DISCORD_USER_TOKEN itself",
  "(env, ~/.toolkit/config.toml [credentials], macOS Keychain), so just start it:",
  "",
  "  toolkit discord daemon start",
  "",
  "If resolution fails, enroll each token in the Keychain (one Touch ID each):",
  "  swift scripts/onepassword/enroll-workstation-secret.swift --service monorepo-workstation-discord-bot-token --ref op://Personal/ytv272dyktkeipt347f2yf5kue/BOT_TOKEN",
  "  swift scripts/onepassword/enroll-workstation-secret.swift --service monorepo-workstation-discord-user-token --ref op://Personal/sskm6skq3mwnyqnhrmqwji6dne/TOKEN",
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
