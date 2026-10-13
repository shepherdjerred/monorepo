import { EmbedBuilder } from "discord.js";
import type { CustomNightSnapshot } from "@scout-for-lol/data";

export function customRecruitmentMessage(snapshot: CustomNightSnapshot): {
  embeds: [EmbedBuilder];
} {
  const counts = snapshot.recruitmentCounts;
  const ended = snapshot.state === "ENDED";
  const needed = `${counts.remaining.toString()} more player${counts.remaining === 1 ? "" : "s"} needed.`;
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Scout Customs")
        .setDescription(
          ended
            ? "This custom-game night has ended."
            : `Open the Scout Customs Activity in this channel to join. ${needed}`,
        )
        .addFields(
          { name: "Ready", value: counts.ready.toString(), inline: true },
          { name: "Maybe", value: counts.maybe.toString(), inline: true },
          { name: "Away", value: counts.away.toString(), inline: true },
          { name: "Held", value: counts.held.toString(), inline: true },
        )
        .setFooter({
          text: "Joining records consent to private custom-game stats for this server. Scout does not create rankings or skill ratings.",
        })
        .setColor(ended ? 0x6b_72_80 : 0x58_65_f2),
    ],
  };
}
