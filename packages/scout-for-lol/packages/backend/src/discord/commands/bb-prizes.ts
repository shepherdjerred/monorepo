import { EmbedBuilder } from "discord.js";
import { formatInteger } from "#src/betting/display-format.ts";

const BUCKS_COLOR = 0x2e_cc_71;
const CAD_PER_BB = 10;

type PrizeCategory =
  | "Vehicles"
  | "Gaming"
  | "League of Legends"
  | "Sports"
  | "Experiences"
  | "Personal experiences";

type BbPrize = {
  category: PrizeCategory;
  emoji: string;
  name: string;
  bbCost: number;
};

export const BB_PRIZES = [
  {
    category: "Vehicles",
    emoji: "🚙",
    name: "RED Jeep Wrangler",
    bbCost: 15_000,
  },
  {
    category: "Vehicles",
    emoji: "🚙",
    name: "RED Jeep Grand Cherokee",
    bbCost: 18_000,
  },
  {
    category: "Vehicles",
    emoji: "🚙",
    name: "Subaru Jimmy",
    bbCost: 20_000,
  },
  {
    category: "Gaming",
    emoji: "🎮",
    name: "NVIDIA RTX 5090",
    bbCost: 1000,
  },
  {
    category: "League of Legends",
    emoji: "🎮",
    name: "Bryan plays one game of League",
    bbCost: 10_000,
  },
  {
    category: "League of Legends",
    emoji: "👑",
    name: "Customs team leader",
    bbCost: 500,
  },
  {
    category: "Sports",
    emoji: "🎙️",
    name: "Virmel narrates one UFC game",
    bbCost: 2500,
  },
  {
    category: "Personal experiences",
    emoji: "☕",
    name: "Coffee with Virmel",
    bbCost: 1000,
  },
  {
    category: "Personal experiences",
    emoji: "🎙️",
    name: "Virmel narrates one game",
    bbCost: 2500,
  },
  {
    category: "Personal experiences",
    emoji: "🛋️",
    name: "Therapy session with Edward",
    bbCost: 100_000,
  },
  {
    category: "Personal experiences",
    emoji: "🤼",
    name: "Wrestling with Danny",
    bbCost: 10_000,
  },
  {
    category: "Personal experiences",
    emoji: "🔧",
    name: "Car repair with Nekoryan",
    bbCost: 50_000,
  },
  {
    category: "Personal experiences",
    emoji: "👋",
    name: "Jerred says “what’s up guys”",
    bbCost: 100,
  },
] as const satisfies readonly BbPrize[];

export function buildBbPrizesEmbed(): EmbedBuilder {
  const categories = [...new Set(BB_PRIZES.map((prize) => prize.category))];
  const fields = categories.map((category) => ({
    name: category,
    value: BB_PRIZES.filter((prize) => prize.category === category)
      .map(
        (prize) =>
          `${prize.emoji} **${prize.name}** — **${formatInteger(prize.bbCost)} BB** / CAD $${formatInteger(prize.bbCost * CAD_PER_BB)}`,
      )
      .join("\n"),
  }));

  return new EmbedBuilder()
    .setTitle("💰 Bryan Bucks prizes")
    .setColor(BUCKS_COLOR)
    .setDescription("Exchange rate: **1 BB = CAD $10**")
    .addFields(fields)
    .setFooter({ text: "Prizes can be redeemed in person with Bryan." });
}
