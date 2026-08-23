import {
  bettingMessageOperationDurationSeconds,
  bettingMessageOperationsTotal,
} from "#src/metrics/betting.ts";
import { ChannelSendError } from "#src/league/discord/channel.ts";
import {
  isMissingChannelError,
  isPermissionError,
} from "#src/discord/utils/permissions.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-delivery");

/**
 * Observability for every Bryan Bucks Discord send and edit.
 *
 * Deliberately per-call-site rather than inside the shared `send()`, for three
 * reasons that compound:
 *
 * 1. `send()` cannot see **edits** at all, and every message refresh is an
 *    edit. That is half the surface area.
 * 2. `send()` cannot see the **skips** — the refresh paths that return before
 *    any Discord call. Those are precisely what "why didn't the message
 *    update?" needs, and they were silent.
 * 3. Threading a surface label through `send()` means touching every caller
 *    anyway, and an "unknown" default would make the label useless.
 *
 * `send()` still owns transport health (`discord_permission_errors_total` and
 * owner escalation); this owns the betting-semantic story.
 */

export type BucksMessageSurface =
  | "prematch"
  | "parlay_preparation"
  | "parlay_market"
  | "settlement"
  | "weekly_leaderboard";

export type BucksMessageOperation = "send" | "edit";

/**
 * Why a refresh returned without touching Discord.
 *
 * These are not equally alarming and must not be logged at the same level.
 * `skipped_no_base` is expected forever for pools created before
 * `prematchContentBase` existed — the schema comment and AGENTS.md both say
 * legacy pools are deliberately not edited, so it must never be alerted on.
 * `skipped_no_refs` follows a failed `recordPoolMessageRefs` and is the
 * leading indicator of "settlement had nowhere to announce".
 */
export type BucksMessageSkipReason =
  "skipped_no_pool" | "skipped_no_base" | "skipped_no_refs";

function classify(
  error: unknown,
): "permission_error" | "channel_missing" | "error" {
  if (error instanceof ChannelSendError && error.permissionError) {
    return "permission_error";
  }
  if (isPermissionError(error)) {
    return "permission_error";
  }
  if (isMissingChannelError(error)) {
    return "channel_missing";
  }
  return "error";
}

/**
 * Time and count one Discord operation, then **rethrow unchanged**.
 *
 * Never swallows: every caller already owns its own catch and Sentry
 * semantics, and `announce.ts`'s per-channel isolation in particular is
 * load-bearing. Swallowing here would silently change product behaviour.
 */
export async function observeBucksDelivery<T>(
  input: {
    surface: BucksMessageSurface;
    operation: BucksMessageOperation;
    matchId?: string;
    serverId?: string;
    channelId?: string;
  },
  run: () => Promise<T>,
): Promise<T> {
  const stop = bettingMessageOperationDurationSeconds.startTimer({
    surface: input.surface,
    operation: input.operation,
  });
  try {
    const result = await run();
    stop();
    bettingMessageOperationsTotal.inc({
      surface: input.surface,
      operation: input.operation,
      result: "success",
    });
    return result;
  } catch (error) {
    stop();
    const result = classify(error);
    bettingMessageOperationsTotal.inc({
      surface: input.surface,
      operation: input.operation,
      result,
    });
    logger.warn("bucks.delivery.failed", {
      event: "bucks.delivery.failed",
      surface: input.surface,
      operation: input.operation,
      result,
      ...(input.matchId === undefined ? {} : { matchId: input.matchId }),
      ...(input.serverId === undefined ? {} : { serverId: input.serverId }),
      ...(input.channelId === undefined ? {} : { channelId: input.channelId }),
    });
    throw error;
  }
}

/** Record a refresh that returned before reaching Discord. */
export function recordBucksDeliverySkip(input: {
  surface: BucksMessageSurface;
  operation: BucksMessageOperation;
  reason: BucksMessageSkipReason;
  matchId: string;
  serverId: string;
}): void {
  bettingMessageOperationsTotal.inc({
    surface: input.surface,
    operation: input.operation,
    result: input.reason,
  });
  const fields = {
    event: "bucks.delivery.skipped",
    surface: input.surface,
    operation: input.operation,
    reason: input.reason,
    matchId: input.matchId,
    serverId: input.serverId,
  };
  if (input.reason === "skipped_no_base") {
    // Expected forever for pre-`prematchContentBase` pools.
    logger.info("bucks.delivery.skipped", fields);
    return;
  }
  logger.warn("bucks.delivery.skipped", fields);
}
