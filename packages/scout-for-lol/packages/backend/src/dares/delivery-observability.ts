import {
  isMissingChannelError,
  isPermissionError,
} from "#src/discord/utils/permissions.ts";
import { ChannelSendError } from "#src/league/discord/channel.ts";
import { createLogger } from "#src/logger.ts";
import {
  dareMessageOperationDurationSeconds,
  dareMessageOperationsTotal,
} from "#src/metrics/dares.ts";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type {
  DiscordChannelId,
  DiscordGuildId,
} from "@scout-for-lol/domain/identity/discord.ts";

const logger = createLogger("dare-delivery");

export type DareMessageSurface = "dare_callout" | "dare_update" | "dare_result";

export type DareMessageOperation = "send" | "edit";

/**
 * Why a refresh returned without touching Discord.
 *
 * These are not equally alarming and must not be logged at the same level.
 * `skipped_no_base` is expected forever for pools created before
 * `prematchContentBase` existed — the schema deliberately leaves those legacy
 * pools uneditable, so it must never be alerted on.
 * `skipped_no_refs` follows a failed `recordPoolMessageRefs` and is the
 * leading indicator of "settlement had nowhere to announce".
 */

function classify(
  error: unknown,
): "permission_error" | "channel_missing" | "error" {
  if (error instanceof ChannelSendError && error.permissionError) {
    return "permission_error";
  }
  if (isPermissionError(error)) {
    return "permission_error";
  }
  return isMissingChannelError(error) ? "channel_missing" : "error";
}

/**
 * Time and count one Discord operation, then **rethrow unchanged**.
 *
 * Never swallows: every caller already owns its own catch and Bugsink
 * semantics, and `announce.ts`'s per-channel isolation in particular is
 * load-bearing. Swallowing here would silently change product behaviour.
 */
export async function observeDareDelivery<T>(
  input: {
    surface: DareMessageSurface;
    operation: DareMessageOperation;
    matchId?: RiotMatchId;
    serverId?: DiscordGuildId;
    channelId?: DiscordChannelId;
  },
  run: () => Promise<T>,
): Promise<T> {
  const stop = dareMessageOperationDurationSeconds.startTimer({
    surface: input.surface,
    operation: input.operation,
  });
  try {
    const result = await run();
    stop();
    dareMessageOperationsTotal.inc({
      surface: input.surface,
      operation: input.operation,
      result: "success",
    });
    return result;
  } catch (error) {
    stop();
    const result = classify(error);
    dareMessageOperationsTotal.inc({
      surface: input.surface,
      operation: input.operation,
      result,
    });
    logger.warn("dare.delivery.failed", {
      event: "dare.delivery.failed",
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
