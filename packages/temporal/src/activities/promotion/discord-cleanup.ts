import { z } from "zod/v4";
import type { PromotionTarget, PromotionRunInput } from "#shared/promotion.ts";
import type { PromotionTaskResult } from "./publication/task-contract.ts";

/** Parent-only cleanup after receipt persistence; never exposed as an agent tool. */
export async function cleanupDiscordReply(input: {
  target: PromotionTarget;
  mode: PromotionRunInput["mode"] | undefined;
  result: {
    receipt: Pick<
      NonNullable<PromotionTaskResult["receipt"]>,
      "status" | "url"
    > | null;
  };
  request: (path: string, body: unknown) => Promise<unknown>;
}) {
  if (
    input.target.id !== "disboard-native-bump" ||
    (input.mode !== "run" && input.mode !== "reconcile") ||
    input.result.receipt?.status !== "verified"
  )
    return null;
  const assignment = input.target.discord;
  if (
    assignment?.slash?.botId !== "302050872383242240" ||
    assignment.slash.command !== "bump"
  )
    throw new Error("DISBOARD cleanup requires the pinned bump command");
  const url = input.result.receipt.url;
  const prefix = `${input.target.url}/`;
  if (!url.startsWith(prefix))
    throw new Error("Cleanup receipt is outside the assigned channel");
  const messageId = z.string().regex(/^\d+$/).parse(url.slice(prefix.length));
  try {
    const response = z
      .object({ deleted: z.literal(true), alreadyAbsent: z.boolean() })
      .parse(
        await input.request("/delete-reply", {
          guildId: assignment.guildId,
          channelId: assignment.channelId,
          messageId,
          expectedAuthorId: assignment.slash.botId,
        }),
      );
    return {
      status: response.alreadyAbsent ? "already-absent" : "deleted",
      receiptUrl: url,
    };
  } catch (error) {
    return {
      status: "blocked",
      receiptUrl: url,
      summary: error instanceof Error ? error.message : String(error),
    };
  }
}
