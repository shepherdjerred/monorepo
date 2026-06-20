import type { QueueType } from "@scout-for-lol/data";
import type { ShowcaseEntry } from "#src/showcase/manifest.ts";

/**
 * Curated "report inside a Discord channel" composites for the marketing
 * site. The chrome (app name, bot message, surrounding chat) is static
 * flavor; `discover` swaps in a fresh real report for `imageKey`/`dataKey`
 * on each run by matching the template's `queue` + `playerCount` against
 * the most-recent postmatch candidate.
 */

type ChatMessage = {
  author: string;
  content: string;
  timestamp?: string;
  authorColor?: string;
  avatarText?: string;
  avatarColor?: string;
};

export type DiscordShowcaseTemplate = {
  id: string;
  title: string;
  group: string;
  description: string;
  /** Which postmatch report kind to source the embed from. */
  queue: QueueType;
  playerCount: number;
  timestamp: string;
  botMessage: string;
  chatMessagesBeforeEmbed: ChatMessage[];
  chatMessagesAfterEmbed: ChatMessage[];
};

const APP_NAME = "Scout for LoL";
const APP_NAME_COLOR = "#ff5a1f";
const BOT_AVATAR_TEXT = "S";
const BOT_AVATAR_COLOR = "#1f2937";
const EMBED_IMAGE_WIDTH = 940;

export const DISCORD_SHOWCASE_TEMPLATES: DiscordShowcaseTemplate[] = [
  {
    id: "arena-discord",
    title: "Arena Discord Screenshot",
    group: "Arena",
    description:
      "Discord message preview for a generated Arena post-match report.",
    queue: "arena",
    playerCount: 3,
    timestamp: "5:23 AM",
    botMessage: "posted an Arena recap",
    chatMessagesBeforeEmbed: [
      {
        timestamp: "5:22 AM",
        author: "rangedtop",
        authorColor: "#23a559",
        avatarText: "R",
        avatarColor: "#23a559",
        content: "drop the arena recap",
      },
    ],
    chatMessagesAfterEmbed: [
      {
        timestamp: "5:24 AM",
        author: "Jerred",
        authorColor: "#ffd400",
        avatarText: "J",
        avatarColor: "#475569",
        content: "we take those",
      },
      {
        author: "Jerred",
        authorColor: "#ffd400",
        avatarText: "J",
        avatarColor: "#475569",
        content: "damage chart checks out",
      },
    ],
  },
  {
    id: "ranked-solo-discord",
    title: "Ranked Solo/Duo Discord Screenshot",
    group: "Ranked Solo",
    description:
      "Discord message preview for a generated Ranked Solo/Duo post-match report.",
    queue: "solo",
    playerCount: 1,
    timestamp: "11:48 PM",
    botMessage: "posted a Ranked recap",
    chatMessagesBeforeEmbed: [
      {
        timestamp: "11:47 PM",
        author: "tankmommy",
        authorColor: "#5865f2",
        avatarText: "T",
        avatarColor: "#5865f2",
        content: "how'd promos go",
      },
    ],
    chatMessagesAfterEmbed: [
      {
        timestamp: "11:49 PM",
        author: "Jerred",
        authorColor: "#ffd400",
        avatarText: "J",
        avatarColor: "#475569",
        content: "ranked up 📈",
      },
      {
        author: "Jerred",
        authorColor: "#ffd400",
        avatarText: "J",
        avatarColor: "#475569",
        content: "the scoreboard doesn't lie",
      },
    ],
  },
  {
    id: "aram-discord",
    title: "ARAM Discord Screenshot",
    group: "ARAM",
    description:
      "Discord message preview for a generated ARAM post-match report.",
    queue: "aram",
    playerCount: 1,
    timestamp: "9:02 PM",
    botMessage: "posted an ARAM recap",
    chatMessagesBeforeEmbed: [
      {
        timestamp: "9:01 PM",
        author: "poromancer",
        authorColor: "#eb459e",
        avatarText: "P",
        avatarColor: "#eb459e",
        content: "aram or feed",
      },
    ],
    chatMessagesAfterEmbed: [
      {
        timestamp: "9:03 PM",
        author: "Jerred",
        authorColor: "#ffd400",
        avatarText: "J",
        avatarColor: "#475569",
        content: "aram diff",
      },
      {
        author: "Jerred",
        authorColor: "#ffd400",
        avatarText: "J",
        avatarColor: "#475569",
        content: "poke comp went brr",
      },
    ],
  },
];

/**
 * Build a `discord-screenshot` entry from a template and a freshly-found
 * source report (imageKey/dataKey).
 */
export function discordScreenshotEntry(
  template: DiscordShowcaseTemplate,
  source: { imageKey: string; dataKey: string },
): ShowcaseEntry {
  return {
    kind: "discord-screenshot",
    id: template.id,
    title: template.title,
    group: template.group,
    description: template.description,
    state: "postmatch",
    queue: template.queue,
    playerCount: template.playerCount,
    imageKey: source.imageKey,
    dataKey: source.dataKey,
    timestamp: template.timestamp,
    appName: APP_NAME,
    appNameColor: APP_NAME_COLOR,
    botMessage: template.botMessage,
    botAvatarText: BOT_AVATAR_TEXT,
    botAvatarColor: BOT_AVATAR_COLOR,
    embedImageWidth: EMBED_IMAGE_WIDTH,
    chatMessagesBeforeEmbed: template.chatMessagesBeforeEmbed,
    chatMessagesAfterEmbed: template.chatMessagesAfterEmbed,
  };
}
