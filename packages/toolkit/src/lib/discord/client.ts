import type { z } from "zod";
import {
  DEFAULT_TTL_SECONDS,
  ErrorResponseSchema,
  SOCKET_PATH,
} from "#lib/discord/ipc.ts";
import {
  cleanDeadDiscordDaemonFiles,
  ensureDiscordDaemon,
  hasAutoStartDiscordTokens,
  probeDiscordDaemonStatus,
} from "#lib/discord/spawn.ts";

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

async function ensureReadyDiscordDaemon(): Promise<void> {
  const existing = await probeDiscordDaemonStatus();
  if (existing !== null) {
    return;
  }

  if (
    Bun.env["TOOLKIT_DISCORD_NO_AUTOSTART"] === "1" ||
    !hasAutoStartDiscordTokens()
  ) {
    await cleanDeadDiscordDaemonFiles();
    throw new Error(START_HINT);
  }

  const { status, started } = await ensureDiscordDaemon({
    ttlSeconds: DEFAULT_TTL_SECONDS,
  });
  if (started) {
    console.error(
      `Started the Discord daemon (pid ${String(status.pid)}); stop it with 'toolkit discord daemon stop'.`,
    );
  }
}

export async function daemonRequest<Schema extends z.ZodType>(
  schema: Schema,
  path: string,
  body?: unknown,
): Promise<z.infer<Schema>> {
  await ensureReadyDiscordDaemon();

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
      `Could not reach the Discord daemon (${message}). The daemon may have exited after accepting the request, so a send or slash command may already have run. Check the target before retrying.\n\n${START_HINT}`,
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
