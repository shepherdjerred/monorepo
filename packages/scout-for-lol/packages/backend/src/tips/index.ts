import type { EmbedBuilder, MessageCreateOptions } from "discord.js";
import { captureFeatureTipShown } from "#src/analytics/feature-tips.ts";
import type { FeatureTipSurface } from "#src/analytics/product-analytics.ts";
import { createLogger } from "#src/logger.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import type { FeatureTip } from "#src/tips/tip-catalog.ts";
import { withFeatureTip, withFeatureTipOnEmbed } from "#src/tips/tip-render.ts";
import { selectTip, type TipSelectionDeps } from "#src/tips/tip-selection.ts";
import {
  claimTip,
  confirmTipClaim,
  releaseTipClaim,
  type TipAudience,
} from "#src/tips/tip-state.ts";

const logger = createLogger("feature-tips");

type TipTarget = TipAudience & { surface: FeatureTipSurface };

/** What a caller must do once it knows whether the send landed. */
export type TipOutcome = {
  /** The send was accepted. Captures analytics; the claim already persisted. */
  confirm: () => Promise<void>;
  /** The send failed. Returns the claim so the tip stays eligible. */
  release: () => Promise<void>;
};

const NO_TIP: TipOutcome = {
  confirm: () => Promise.resolve(),
  release: () => Promise.resolve(),
};

/**
 * Both halves swallow their own failures: they run around a message that has
 * already reached Discord, or failed to, and neither outcome may be turned
 * into a caller-visible error by bookkeeping.
 */
function outcome(
  tip: FeatureTip,
  audience: TipTarget,
  deps: TipSelectionDeps,
): TipOutcome {
  return {
    confirm: async () => {
      try {
        await confirmTipClaim({ ...audience, tipKey: tip.key }, deps.db);
        await captureFeatureTipShown({
          guildId: audience.serverId,
          tipKey: tip.key,
          surface: audience.surface,
        });
      } catch (error) {
        logger.error(
          "Failed to capture a delivered feature tip",
          getErrorMessage(error),
        );
      }
    },
    release: async () => {
      try {
        await releaseTipClaim({ ...audience, tipKey: tip.key }, deps.db);
      } catch (error) {
        // The tip stays claimed and simply is not offered again. Worse for
        // discovery than a clean release, but never a wrong message.
        logger.error(
          "Failed to release an unsent feature tip",
          getErrorMessage(error),
        );
      }
    },
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
): Promise<{ message: MessageCreateOptions } & TipOutcome> {
  const unchanged = { message, ...NO_TIP };
  try {
    const tip = await selectTip(audience, deps);
    if (tip === undefined) return unchanged;

    const decorated = withFeatureTip(message, tip);
    // `withFeatureTip` refuses a message with no embed or an occupied footer.
    // Checked before claiming, so a message that cannot show the tip does not
    // retire it unseen.
    if (decorated === message) return unchanged;

    return (await claimTip({ ...audience, tipKey: tip.key }, deps.db))
      ? { message: decorated, ...outcome(tip, audience, deps) }
      : unchanged;
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
): Promise<{ embed: EmbedBuilder } & TipOutcome> {
  const unchanged = { embed, ...NO_TIP };
  try {
    const tip = await selectTip(audience, deps);
    if (tip === undefined) return unchanged;

    const decorated = withFeatureTipOnEmbed(embed, tip);
    if (decorated === undefined) return unchanged;

    return (await claimTip({ ...audience, tipKey: tip.key }, deps.db))
      ? { embed: decorated, ...outcome(tip, audience, deps) }
      : unchanged;
  } catch (error) {
    logger.error("Failed to select a feature tip", getErrorMessage(error));
    return unchanged;
  }
}
