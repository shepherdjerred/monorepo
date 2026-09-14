import { EmbedBuilder, type APIEmbed, type JSONEncodable } from "discord.js";
import { describe, expect, test } from "vitest";
import type { FeatureTip } from "#src/tips/tip-catalog.ts";
import { withFeatureTip, withFeatureTipOnEmbed } from "#src/tips/tip-render.ts";

function footerTextOf(
  embed: APIEmbed | JSONEncodable<APIEmbed> | undefined,
): string | undefined {
  if (embed === undefined) return undefined;
  return ("toJSON" in embed ? embed.toJSON() : embed).footer?.text;
}

const TIP: FeatureTip = {
  key: "competitions",
  flag: "always",
  text: "Tip: run a competition.",
};

describe("withFeatureTipOnEmbed", () => {
  test("writes the tip into a free footer", () => {
    const decorated = withFeatureTipOnEmbed(
      new EmbedBuilder().setTitle("Match report"),
      TIP,
    );
    expect(decorated?.toJSON().footer?.text).toBe(TIP.text);
  });

  test("refuses an embed whose footer already says something", () => {
    const embed = new EmbedBuilder().setFooter({ text: "Competition ID: 7" });
    expect(withFeatureTipOnEmbed(embed, TIP)).toBeUndefined();
  });

  test("never mutates its argument", () => {
    // One built embed is delivered to every subscribed guild, so an in-place
    // write would leak one guild's tip into the next guild's copy.
    const original = new EmbedBuilder().setTitle("Match report");
    withFeatureTipOnEmbed(original, TIP);
    expect(original.toJSON().footer).toBeUndefined();
  });

  test("refuses a tip longer than Discord's footer limit", () => {
    const long = { ...TIP, text: "x".repeat(2049) };
    expect(
      withFeatureTipOnEmbed(new EmbedBuilder().setTitle("t"), long),
    ).toBeUndefined();
  });
});

describe("withFeatureTip", () => {
  test("decorates the last embed and leaves the rest alone", () => {
    const message = {
      content: "hello",
      embeds: [
        new EmbedBuilder().setTitle("first"),
        new EmbedBuilder().setTitle("last"),
      ],
    };
    const decorated = withFeatureTip(message, TIP);
    const embeds = decorated.embeds ?? [];
    expect(embeds).toHaveLength(2);
    expect(footerTextOf(embeds[0])).toBeUndefined();
    expect(footerTextOf(embeds[1])).toBe(TIP.text);
    expect(decorated.content).toBe("hello");
  });

  test("leaves a plain-text message untouched", () => {
    const message = { content: "just text" };
    expect(withFeatureTip(message, TIP)).toBe(message);
  });

  test("leaves a message whose only embed has a footer untouched", () => {
    const message = {
      embeds: [new EmbedBuilder().setFooter({ text: "Series 4" })],
    };
    expect(withFeatureTip(message, TIP)).toBe(message);
  });
});
