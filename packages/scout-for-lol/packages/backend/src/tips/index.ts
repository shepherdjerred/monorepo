import type { EmbedBuilder, MessageCreateOptions } from "discord.js";
import { captureFeatureTipShown } from "#src/analytics/feature-tips.ts";
import type { FeatureTipSurface } from "#src/analytics/product-analytics.ts";
import { createLogger } from "#src/logger.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import type { FeatureTip } from "#src/tips/tip-catalog.ts";
import { withFeatureTip, withFeatureTipOnEmbed } from "#src/tips/tip-render.ts";
import { selectTip, type TipSelectionDeps } from "#src/tips/tip-selection.ts";
import { recordTipShown, type TipAudience } from "#src/tips/tip-state.ts";

const logger = createLogger("feature-tips");

type TipTarget = TipAudience & { surface: FeatureTipSurface };

/**
 * Record the impression and capture the analytics event.
 *
 * Deliberately swallows its own failures: this runs after a message has
 * already reached Discord, so nothing here may turn a delivered message into a
 * caller-visible error. The cost of a lost write is one tip that may be
 * offered again, which is the safe direction.
 */
function confirmation(
  tip: FeatureTip,
  audience: TipTarget,
  deps: TipSelectionDeps,
): () => Promise<void> {
  return async () => {
    try {
      await recordTipShown({ ...audience, tipKey: tip.key }, deps.db);
      await captureFeatureTipShown({
        guildId: audience.serverId,
        tipKey: tip.key,
        surface: audience.surface,
      });
    } catch (error) {
      logger.error(
        "Failed to record a delivered feature tip",
        getErrorMessage(error),
      );
    }
  };
}

/**
 * Decorate one outbound message with a feature tip, if this audience is due
 * one.
 *
 * Returns the message unchanged on every refusal and on any failure. Tips are
 * a garnish on messages that matter, so nothing here may turn a deliverable
 * message into a failed send.
 *
 * The impression is recorded by the returned `confirm` after the send is
 * accepted, never here: a tip on a message that never arrived must stay
 * eligible.
 */
export async function decorateWithFeatureTip(
  message: MessageCreateOptions,
  audience: TipTarget,
  deps: TipSelectionDeps = {},
): Promise<{
  message: MessageCreateOptions;
  confirm: () => Promise<void>;
}> {
  const unchanged = { message, confirm: () => Promise.resolve() };
  try {
    const tip = await selectTip(audience, deps);
    if (tip === undefined) return unchanged;

    const decorated = withFeatureTip(message, tip);
    // `withFeatureTip` refuses a message with no embed or an occupied footer.
    // Burning the tip on a message that cannot show it would retire it unseen.
    if (decorated === message) return unchanged;

    return { message: decorated, confirm: confirmation(tip, audience, deps) };
  } catch (error) {
    logger.error("Failed to select a feature tip", getErrorMessage(error));
    return unchanged;
  }
}

/**
 * The embed-level twin of {@link decorateWithFeatureTip}, for surfaces whose
 * transport takes embeds rather than a whole message — Bryan Bucks DMs, whose
 * `sendDM` chokepoint decides the wire shape itself.
 */
export async function decorateEmbedWithFeatureTip(
  embed: EmbedBuilder,
  audience: TipTarget,
  deps: TipSelectionDeps = {},
): Promise<{ embed: EmbedBuilder; confirm: () => Promise<void> }> {
  const unchanged = { embed, confirm: () => Promise.resolve() };
  try {
    const tip = await selectTip(audience, deps);
    if (tip === undefined) return unchanged;

    const decorated = withFeatureTipOnEmbed(embed, tip);
    if (decorated === undefined) return unchanged;

    return { embed: decorated, confirm: confirmation(tip, audience, deps) };
  } catch (error) {
    logger.error("Failed to select a feature tip", getErrorMessage(error));
    return unchanged;
  }
}
