import { DiscordAPIError, RESTJSONErrorCodes } from "discord.js";

/**
 * True when a Discord ack/reply failed only because the interaction is stale:
 * already acknowledged (40060 — a prior ack was delivered even though our REST
 * call rejected) or its 3-second token expired (10062 — e.g. the event loop
 * stalled under media work before the first defer). In both cases the message
 * can no longer be delivered, so callers treat the failure as a no-op.
 */
export function isStaleInteractionError(error: unknown): boolean {
  return (
    error instanceof DiscordAPIError &&
    (error.code === RESTJSONErrorCodes.InteractionHasAlreadyBeenAcknowledged ||
      error.code === RESTJSONErrorCodes.UnknownInteraction)
  );
}

/** Normalize an unknown thrown value to a readable message (never throws). */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Parse JSON to `unknown` (caller must validate with Zod) — avoids `as Type` assertions. */
export function parseJson(text: string): unknown {
  return JSON.parse(text);
}
