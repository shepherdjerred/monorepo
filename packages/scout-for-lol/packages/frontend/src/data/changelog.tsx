import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildChangelogEntry,
  ChangelogSection,
  type ChangelogEntry,
} from "./changelog-builder.tsx";

export function renderChangelogToHtml(content: ReactNode): string {
  return renderToStaticMarkup(content);
}

export const changelog: ChangelogEntry[] = [
  buildChangelogEntry({
    date: "2026 07 18",
    banner: "Updated for League patch 26.14",
    sections: [
      {
        title: "Game Data",
        color: "indigo",
        items: [
          "Champion, item, summoner spell, and rune data refreshed for League patch 26.14",
          "Azir's W and R get a big mechanics overhaul — full on-hit damage and better teamfight control.",
          "Mordekaiser, Corki, Nami, and Yunara pick up scaling buffs and hit harder late.",
          "Senna, Seraphine, Garen, and Jayce all take nerfs to their power spikes.",
          "Blue Buff now scales with level, rewarding junglers and mages who control it.",
        ],
      },
    ],
    link: {
      label: "Read Riot's full Patch 26.14 notes",
      href: "https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-14-notes",
    },
  }),
  buildChangelogEntry({
    date: "2026 06 28",
    banner: "Updated for League patch 26.13",
    sections: [
      {
        title: "Game Data",
        color: "indigo",
        items: [
          "Champion, item, summoner spell, and rune data refreshed for League patch 26.13",
          "New champion Locke, the Ashen Exorcist, arrives with demon-hunting abilities",
          "Ranked 5v5 returns for a limited-time run with Tournament Draft",
          "Champion balance shifts: buffs to Aphelios, Draven, and Kai'Sa; nerfs to Bard, Brand, and Cassiopeia",
        ],
      },
    ],
    link: {
      label: "Read Riot's full Patch 26.13 notes",
      href: "https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-13-notes/",
    },
  }),
  {
    date: "2026 05 23",
    banner: (
      <>
        <strong>Lane-sorted prematch</strong>, Arena teams of 3, and scheduled{" "}
        <strong>/report</strong> posts
      </>
    ),
    text: (
      <>
        <ChangelogSection
          title="Prematch"
          color="teal"
          items={[
            "Summoner's Rift loading screens now infer lane order so champions appear top, jungle, mid, bottom, and support instead of random participant order",
          ]}
        />
        <ChangelogSection
          title="Post-Match Reports"
          color="green"
          className="mt-6"
          items={[
            "Draft and ranked post-match notifications now show champion icons",
          ]}
        />
        <ChangelogSection
          title="Arena"
          color="purple"
          className="mt-6"
          items={[
            "Full support for current Arena teams of 3 across 18-player matches",
          ]}
        />
        <ChangelogSection
          title="Scheduled Reports"
          color="yellow"
          className="mt-6"
          items={[
            "New /report commands can schedule recurring Discord posts from stored match history",
            "Servers can build recurring tables and leaderboards for surrender trends, champion stats, pairing performance, and rank snapshots",
          ]}
        />
      </>
    ),
    formatted: {
      year: 2026,
      month: 5,
      day: 23,
    },
  },
  {
    date: "2026 05 23",
    banner: (
      <>
        <strong>Privacy policy update</strong> — clarified marketing and
        documentation use
      </>
    ),
    text: (
      <>
        <ChangelogSection
          title="Privacy"
          color="blue"
          items={[
            "Updated the privacy policy to clarify that collected data and generated report artifacts may be used for marketing and documentation",
            "Called out generated images, graphs, charts, reports, and related Scout output as examples of materials that may be shown in docs or promotional content",
          ]}
        />
      </>
    ),
    formatted: {
      year: 2026,
      month: 5,
      day: 23,
    },
  },
  {
    date: "2026 04 20",
    banner: (
      <>
        <strong>Pre-match loading screens</strong> — full splash-art previews
        when your friends start a game
      </>
    ),
    text: (
      <>
        <ChangelogSection
          title="Pre-Match Detection"
          color="teal"
          items={[
            "Get notified the moment your friends start a League match",
            "Rich loading-screen image with splash art, summoner spells, runes, and live ranks for every player",
            "Supports Summoner's Rift, ARAM, and Arena layouts — with bans for ranked and draft",
            "Multiple tracked players in the same game are grouped into one notification",
            "Falls back to a text-only embed if image generation fails",
          ]}
        />
        <ChangelogSection
          title="New Commands"
          color="green"
          className="mt-6"
          items={[
            "/me — Look up your own or any player's connected accounts (no admin required)",
            "/admin player-list — List all tracked players in your server",
            "/subscription add-channel — Add a player to an additional channel",
            "/subscription move — Move a subscription between channels",
          ]}
        />
      </>
    ),
    formatted: {
      year: 2026,
      month: 4,
      day: 20,
    },
  },
  {
    date: "2026 02 22",
    banner: (
      <>
        <strong>Riot app approval</strong> — faster reports and new features
        ahead
      </>
    ),
    text: (
      <>
        <ChangelogSection
          title="Riot App Approval"
          color="green"
          items={[
            "Scout has been approved by Riot Games, unlocking higher API rate limits",
            "Post-match reports now arrive faster thanks to more frequent polling",
          ]}
        />
        <ChangelogSection
          title="Bug Fixes"
          color="blue"
          items={["Fixed API integration issues for improved reliability"]}
          className="mt-6"
        />
      </>
    ),
    formatted: {
      year: 2026,
      month: 2,
      day: 22,
    },
  },
  {
    date: "2026 01 31",
    banner: (
      <>
        <strong>Season 2026</strong> data updates and Arena improvements
      </>
    ),
    text: (
      <>
        <ChangelogSection
          title="Season 2026 Support"
          color="indigo"
          items={[
            "Support for new Riot API data structures including role-specific starting items",
            "Updated champion, item, and rune data for latest patches",
          ]}
        />
        <ChangelogSection
          title="Arena"
          color="purple"
          items={[
            "Improved arena augment data with complete augment icons",
            "More reliable augment display in match reports",
          ]}
          className="mt-6"
        />
        <ChangelogSection
          title="Bug Fixes"
          color="green"
          items={[
            "Improved reliability and stability",
            "Various performance improvements",
          ]}
          className="mt-6"
        />
      </>
    ),
    formatted: {
      year: 2026,
      month: 1,
      day: 31,
    },
  },
  {
    date: "2025 11 30",
    banner: (
      <>
        <strong>Rune displays</strong> on match reports
      </>
    ),
    text: (
      <>
        <ChangelogSection
          title="Match Reports"
          color="green"
          items={["Display rune selections for all players in match reports"]}
        />
      </>
    ),
    formatted: {
      year: 2025,
      month: 11,
      day: 30,
    },
  },
  {
    date: "2025 11 23",
    banner: (
      <>
        <strong>Clash indicator</strong> and{" "}
        <strong>promotions/demotions</strong> on match reports
      </>
    ),
    text: (
      <>
        <ChangelogSection
          title="Match Reports"
          color="yellow"
          items={[
            "Add clash badge indicator for clash and ARAM clash games",
            "Display promotions and demotions for all players in flex and duo queue matches",
          ]}
        />
      </>
    ),
    formatted: {
      year: 2025,
      month: 11,
      day: 23,
    },
  },
  {
    date: "2025 11 16",
    banner: (
      <>
        <strong>Arena reports</strong> with augment icons,{" "}
        <strong>subscription limits</strong> increased, and more!
      </>
    ),
    text: (
      <>
        <ChangelogSection
          title="Arena Reports"
          color="indigo"
          items={[
            "Add augment icons",
            "Reorganize report image layout",
            "Add team KDA",
          ]}
          className="mb-6"
        />
        <ChangelogSection
          title="Subscription Commands"
          color="blue"
          items={[
            "Increase limits from 10 → 50 accounts per server",
            "Increase limits from 10 → 75 subscriptions per server",
            "Add messages for approaching limits",
          ]}
          className="mb-6"
        />
        <ChangelogSection
          title="Site"
          color="purple"
          items={["Add changelog and What's New page"]}
        />
      </>
    ),
    formatted: {
      year: 2025,
      month: 11,
      day: 16,
    },
  },
];

export function formatChangelogDate(entry: ChangelogEntry): string {
  const { year, month, day } = entry.formatted;
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
