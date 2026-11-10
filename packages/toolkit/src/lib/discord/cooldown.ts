import { RateLimitError } from "discord.js-selfbot-v13";
import { DaemonError } from "#lib/discord/error.ts";

/** Only the SDK's rejected mutation can establish that no effect occurred. */
export class DiscordCooldownError extends DaemonError {
  readonly retryAfterMs: number;
  readonly nextEligibleAt: string;

  constructor(timeout: number) {
    super("Discord rejected the action due to a cooldown", 429);
    this.retryAfterMs = Math.ceil(timeout);
    this.nextEligibleAt = new Date(
      Date.now() + this.retryAfterMs,
    ).toISOString();
  }
}

export function discordErrorResponse(error: unknown): Response {
  if (error instanceof DiscordCooldownError)
    return Response.json(
      {
        code: "DISCORD_COOLDOWN",
        effect: "not-sent",
        error: error.message,
        retryAfterMs: error.retryAfterMs,
        nextEligibleAt: error.nextEligibleAt,
      },
      { status: 429 },
    );
  const status = error instanceof DaemonError ? error.status : 500;
  return Response.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status },
  );
}

export function throwDiscordWriteError(
  error: unknown,
  expectedPath: string,
): never {
  if (
    error instanceof RateLimitError &&
    error.method.toLowerCase() === "post" &&
    error.path === expectedPath &&
    Number.isFinite(error.timeout) &&
    error.timeout > 0 &&
    Number.isSafeInteger(Math.ceil(error.timeout)) &&
    Number.isFinite(new Date(Date.now() + Math.ceil(error.timeout)).getTime())
  ) {
    throw new DiscordCooldownError(error.timeout);
  }
  throw error;
}
