import { createHash } from "node:crypto";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { DiscordGuildId } from "@scout-for-lol/domain/identity/discord.ts";

/**
 * Notification-intent keys and the attempt nonce the notification pipeline
 * sends under.
 *
 * An intent key is deliberately the same string as the effect key its send
 * claims, and the attempt nonce is derived from it, so the nonce Discord sees
 * under `enforceNonce` and the nonce the intent records cannot disagree.
 */

/**
 * Discord's `nonce` field is limited to 25 characters, which is where the
 * slice comes from; base64url keeps it to characters Discord accepts.
 */
export function deliveryAttemptNonce(effectKey: string): string {
  return createHash("sha256")
    .update(effectKey)
    .digest("base64url")
    .slice(0, 25);
}

/**
 * The shared prefix of one game's PREMATCH delivery keys.
 *
 * Exported because the per-game Activity mints against it and the prematch
 * reads and markets look the intents up by it; all of them have to compute the
 * same key or the same channel gets two intent rows and a user gets told
 * twice, so the format lives here rather than in any one caller.
 */
export function prematchDeliveryKeyPrefix(matchId: RiotMatchId): string {
  return `prematch-discord:${matchId}`;
}

/**
 * The shared prefix of one match's POST-MATCH delivery keys: the intent key
 * for the visible report, and — because the delivered post-match intent's
 * `messageId` is what a later settlement announcement replies to — the key the
 * settlement arm looks that message up by.
 */
export function postmatchDeliveryKeyPrefix(matchId: RiotMatchId): string {
  return `postmatch-discord:${matchId}`;
}

/**
 * The shared prefix of one match's SETTLEMENT announcement keys.
 *
 * Separate from the post-match report's prefix because they are different
 * decisions to notify about the same match: the report is owed to every
 * subscribed channel, the recap only to a guild whose pool actually settled
 * something a player can read. One key per (match, channel), so a guild that
 * settled twice for one match is a contradiction the key makes unrepresentable
 * rather than two recaps a user would receive.
 */
export function settlementDeliveryKeyPrefix(matchId: RiotMatchId): string {
  return `settlement-discord:${matchId}`;
}

/**
 * A late binding's earnings-only recap is a separate delivery decision from
 * the settlement recap the completed match pipeline may already have sent.
 */
export function lateBindingEarningsDeliveryKeyPrefix(
  matchId: RiotMatchId,
): string {
  return `late-earnings-discord:${matchId}`;
}

/** One channel's intent key under a delivery prefix. */
export function deliveryIntentKey(
  keyPrefix: string,
  channelId: string,
): string {
  return `${keyPrefix}:${channelId}`;
}

/**
 * The key of one guild's Hall of Fame record-break announcement for a match.
 *
 * Keyed by GUILD rather than by channel, unlike every per-channel key above,
 * because the decision to notify is one announcement per (guild, match), and
 * the Hall channel is a setting that can change between
 * two evaluations of the same match. Keying by channel would let one
 * re-evaluation after a channel change mint a second announcement of the same
 * records. The channel is the intent's target column, and every reader takes
 * the target (and the key) from the stored row rather than rebuilding them.
 */
export function hallRecordBreakIntentKey(
  riotMatchId: RiotMatchId,
  guildId: DiscordGuildId,
): string {
  return `hall-record-break:${riotMatchId}:${guildId}`;
}
