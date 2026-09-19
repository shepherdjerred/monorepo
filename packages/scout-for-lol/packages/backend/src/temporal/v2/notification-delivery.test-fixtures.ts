import { vi } from "vitest";
import { NotificationIntentKeySchema } from "@scout-for-lol/domain/identity/brands.ts";
import type * as DiscordChannelModule from "#src/league/discord/channel.ts";
import { NotificationAttemptNonceSchema } from "@scout-for-lol/domain/notifications/intent.ts";
import type { ScoutIntentAttemptRefV2 } from "@scout-for-lol/temporal/contracts-v2";

/**
 * What the two delivery boundary suites share: one intent, one attempt, and
 * the stored record for each kind and target. The module mocks stay in each
 * suite, because `vi.mock` is hoisted per file.
 */

export const intentKey = NotificationIntentKeySchema.parse(
  "postmatch-discord:NA1_9301:100000000000000001",
);
export const CHANNEL_ID = "100000000000000001";
const ACCOUNT_ID = "200000000000000002";

export function attemptRef(): ScoutIntentAttemptRefV2 {
  return {
    stage: "dev",
    intentKey,
    attemptNonce: NotificationAttemptNonceSchema.parse("attempt-nonce-1"),
  };
}

export function intentRecord(
  target: "channel" | "dm",
  kind: "postmatch" | "prematch" | "settlement" | "dare-summary" = "postmatch",
  /** Overridden when a suite delivers one match's intent to two channels. */
  channelId: string = CHANNEL_ID,
): unknown {
  return {
    matchId: "NA1_9301",
    intent: {
      key: intentKey,
      kind,
      origin: { kind: "live" },
      ...(kind === "settlement" || kind === "dare-summary"
        ? {
            announcement: {
              kind: `scout-${kind}-announcement`,
              version: 1,
              data: {},
            },
          }
        : {}),
      target:
        target === "channel"
          ? { kind: "channel", channelId }
          : { kind: "dm", accountId: ACCOUNT_ID },
    },
  };
}

/**
 * The channel module with only `send` replaced: the real error class and the
 * real reply-permission predicates, because the classifier narrows on
 * `instanceof` and a fake would make every send failure look unclassifiable.
 * Called from each suite's `vi.mock` factory, which is hoisted per file.
 */
export async function channelModuleWithSend(
  send: typeof DiscordChannelModule.send,
): Promise<
  Pick<
    typeof DiscordChannelModule,
    | "ChannelSendError"
    | "isReplyPermissionError"
    | "markReplyPermissionError"
    | "send"
  >
> {
  const actual = await vi.importActual<typeof DiscordChannelModule>(
    "#src/league/discord/channel.ts",
  );
  return {
    ChannelSendError: actual.ChannelSendError,
    isReplyPermissionError: actual.isReplyPermissionError,
    markReplyPermissionError: actual.markReplyPermissionError,
    send,
  };
}
