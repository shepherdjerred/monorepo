import {
  EmbedBuilder,
  type APIEmbed,
  type JSONEncodable,
  type MessageCreateOptions,
} from "discord.js";
import type { FeatureTip } from "#src/tips/tip-catalog.ts";

/** Discord's embed footer limit. A tip is one line; this is the hard stop. */
const MAX_FOOTER_LENGTH = 2048;

/**
 * `MessageCreateOptions.embeds` holds either plain API objects or anything
 * that can encode itself into one. Both shapes have to be read before a footer
 * can be inspected, so normalise once here.
 */
function toApiEmbed(embed: APIEmbed | JSONEncodable<APIEmbed>): APIEmbed {
  return "toJSON" in embed ? embed.toJSON() : embed;
}

/**
 * A copy of `embed` carrying the tip in its footer, or undefined when the
 * embed cannot take one.
 *
 * The single refusal is an occupied footer: a footer that already says
 * something (a competition ID, a series ID) is the message's own content, and
 * a tip must not displace it. Never mutates its argument — one built embed is
 * delivered to every subscribed guild, so writing in place would leak one
 * guild's tip into the next guild's copy.
 */
export function withFeatureTipOnEmbed(
  embed: EmbedBuilder,
  tip: FeatureTip,
): EmbedBuilder | undefined {
  const data = embed.toJSON();
  if (data.footer !== undefined) return undefined;
  return tip.text.length > MAX_FOOTER_LENGTH
    ? undefined
    : new EmbedBuilder(data).setFooter({ text: tip.text });
}

/**
 * A copy of `message` whose last embed carries the tip, or the message
 * unchanged when it has no embed to write on or that embed refuses the footer.
 *
 * Plain-text outputs are deliberately left alone rather than growing an extra
 * line.
 */
export function withFeatureTip(
  message: MessageCreateOptions,
  tip: FeatureTip,
): MessageCreateOptions {
  const embeds = message.embeds;
  if (embeds === undefined || embeds.length === 0) return message;

  const lastIndex = embeds.length - 1;
  const last = embeds[lastIndex];
  if (last === undefined) return message;

  const decorated = withFeatureTipOnEmbed(
    new EmbedBuilder(toApiEmbed(last)),
    tip,
  );
  if (decorated === undefined) return message;

  return {
    ...message,
    embeds: [...embeds.slice(0, lastIndex), decorated],
  };
}
