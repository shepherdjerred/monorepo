import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import { writeFile } from "node:fs/promises";
import { resolveTheme } from "@shepherdjerred/storm-theme";
import { renderCard } from "@shepherdjerred/storm-theme/render";
import { createAstroCacheDir } from "./src/astro-cache.mjs";

export default defineConfig({
  vite: { cacheDir: createAstroCacheDir() },
  devToolbar: { enabled: false },
  server: { host: "127.0.0.1", port: 18797, strictPort: true },
  build: {
    format: "directory",
  },
  redirects: {
    "/survival/safety/": "/survival/pvp/",
    "/survival/day-on-the-storm/": "/survival/shared-world/",
  },
  integrations: [
    {
      name: "storm-static-card",
      hooks: {
        "astro:build:done": async ({ dir }) => {
          await writeFile(
            new URL("storm-card.png", dir),
            await renderCard({
              theme: resolveTheme("auto", true, new Date()),
              title: "The Storm player docs",
              section: "Minecraft Java + Bedrock",
              description:
                "A place to build, explore, and catch up. Server IP: ts-mc.net",
            }),
          );
        },
      },
    },
    sitemap(),
    starlight({
      customCss: ["../storm-theme/src/styles.css", "./src/styles/custom.css"],
      components: {
        Head: "./src/components/Head.astro",
        Header: "./src/components/Header.astro",
        ThemeProvider: "./src/components/ThemeProvider.astro",
        ThemeSelect: "./src/components/ThemeSelect.astro",
        PageFrame: "./src/components/PageFrame.astro",
        TwoColumnContent: "./src/components/TwoColumnContent.astro",
      },
      description: "Documentation for The Storm Minecraft server.",
      favicon: "/storm/brand/favicon.svg",
      head: [
        {
          tag: "script",
          attrs: { src: "/posthog.js", defer: true },
        },
        {
          tag: "meta",
          attrs: { name: "twitter:card", content: "summary_large_image" },
        },
      ],
      lastUpdated: true,
      logo: {
        src: "../storm-theme/assets/brand/mark.svg",
        alt: "The Storm",
      },
      pagefind: true,
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Welcome", link: "/" },
            { label: "How to join", link: "/join/" },
            { label: "Your first session", link: "/getting-started/" },
            { label: "About The Storm", link: "/about/" },
          ],
        },
        {
          label: "Survival and worlds",
          collapsed: true,
          items: [
            { label: "Overview", link: "/survival/" },
            { label: "The shared world", link: "/survival/shared-world/" },
            { label: "Spawn", link: "/survival/spawn/" },
            { label: "Worlds", link: "/survival/worlds/" },
            { label: "Travel", link: "/survival/travel/" },
            { label: "PvP and safety", link: "/survival/pvp/" },
            { label: "Graves", link: "/survival/graves/" },
            {
              label: "Vanilla differences",
              link: "/survival/vanilla-differences/",
            },
            { label: "LiveMap", link: "/survival/livemap/" },
            { label: "Transparency", link: "/survival/transparency/" },
            { label: "World downloads", link: "/world_downloads/" },
            {
              label: "Advanced survival",
              collapsed: true,
              items: [
                {
                  label: "Combat and beginner protection",
                  link: "/survival/advanced/combat/",
                },
                {
                  label: "Recover a grave",
                  link: "/survival/advanced/grave-recovery/",
                },
                {
                  label: "Levelled monsters",
                  link: "/survival/advanced/monsters/",
                },
                {
                  label: "Travel commands in detail",
                  link: "/survival/advanced/travel/",
                },
                {
                  label: "Beginner's Luck",
                  link: "/survival/advanced/beginners-luck/",
                },
                {
                  label: "Teleport to another player",
                  link: "/survival/advanced/teleport-requests/",
                },
              ],
            },
          ],
        },
        {
          label: "Homes",
          collapsed: true,
          items: [
            { label: "Camps and towns", link: "/homes/camps-and-towns/" },
            { label: "Locks", link: "/homes/locks/" },
            {
              label: "Managing homes",
              collapsed: true,
              items: [
                { label: "Sharing land", link: "/homes/sharing-land/" },
                { label: "Claim settings", link: "/homes/claim-settings/" },
                { label: "Managing locks", link: "/homes/managing-locks/" },
                { label: "Sharing a camp", link: "/homes/sharing-a-camp/" },
                { label: "Town roles", link: "/homes/town-roles/" },
              ],
            },
          ],
        },
        {
          label: "Trading and everyday life",
          collapsed: true,
          items: [
            { label: "Shops", link: "/trading/shops/" },
            { label: "NPC shops", link: "/trading/npc-shops/" },
            { label: "Crystals", link: "/trading/crystals/" },
            { label: "Deposit banks", link: "/everyday/deposit-banks/" },
            { label: "Sorting", link: "/everyday/sorting/" },
            {
              label: "Advanced trading and storage",
              collapsed: true,
              items: [
                { label: "Managing a shop", link: "/trading/managing-shops/" },
                {
                  label: "Sort and deposit items",
                  link: "/everyday/advanced/storage/",
                },
                {
                  label: "Configure deposit shelves",
                  link: "/everyday/advanced/bank-shelves/",
                },
                {
                  label: "Configure item sorting",
                  link: "/everyday/advanced/sorting-controls/",
                },
                {
                  label: "Renting a market plot",
                  link: "/trading/renting-a-market-plot/",
                },
                {
                  label: "Shop sign examples",
                  link: "/trading/shop-sign-examples/",
                },
              ],
            },
          ],
        },
        {
          label: "Progression",
          collapsed: true,
          items: [
            { label: "Tracks", link: "/progression/tracks/" },
            { label: "Skills", link: "/progression/skills/" },
            { label: "Spells", link: "/progression/spells/" },
            { label: "Shards", link: "/progression/shards/" },
            { label: "Stargates", link: "/progression/stargates/" },
            { label: "Mechanisms", link: "/progression/mechanisms/" },
            {
              label: "Decorating tools",
              link: "/progression/decorating-tools/",
            },
            {
              label: "Progression reference",
              collapsed: true,
              items: [
                {
                  label: "Spell catalogue",
                  link: "/progression/spell-catalogue/",
                },
                { label: "Repair equipment", link: "/progression/repair/" },
                {
                  label: "Special pistons",
                  link: "/progression/special-pistons/",
                },
                {
                  label: "Switches and cooking pots",
                  link: "/progression/switches-and-cooking/",
                },
                {
                  label: "Elevators and moving structures",
                  link: "/progression/moving-structures/",
                },
                {
                  label: "Build Stargates",
                  link: "/progression/build-stargates/",
                },
                {
                  label: "Stargate networks",
                  link: "/progression/stargate-networks/",
                },
                {
                  label: "Finding Storm Shards",
                  link: "/progression/finding-shards/",
                },
                {
                  label: "Upgrading with Storm Shards",
                  link: "/progression/shard-upgrades/",
                },
                { label: "Skill guide", link: "/progression/skill-guide/" },
                { label: "Track levels", link: "/progression/track-levels/" },
              ],
            },
          ],
        },
        {
          label: "Adventures and games",
          collapsed: true,
          items: [
            { label: "Quests and NPCs", link: "/adventures/quests-and-npcs/" },
            { label: "Advancements", link: "/adventures/advancements/" },
            { label: "Seasonal events", link: "/adventures/seasonal-events/" },
            {
              label: "Quest reference",
              collapsed: true,
              items: [
                {
                  label: "Quest progress",
                  link: "/adventures/quest-progress/",
                },
                {
                  label: "Quest board and discoveries",
                  link: "/adventures/quest-board-and-discoveries/",
                },
                {
                  label: "Daily and weekly quests",
                  link: "/adventures/daily-and-weekly-quests/",
                },
                { label: "Field notes", link: "/adventures/field-notes/" },
              ],
            },
            { label: "Mob Arena", link: "/games/mob-arena/" },
            {
              label: "Mob Arena classes and waves",
              link: "/games/mob-arena-classes-and-waves/",
            },
            { label: "Search and Destroy", link: "/search-and-destroy/" },
            {
              label: "Search and Destroy reference",
              collapsed: true,
              items: [
                { label: "Kits", link: "/games/search-and-destroy-kits/" },
                { label: "Bombs", link: "/games/search-and-destroy-bombs/" },
                {
                  label: "Match details",
                  link: "/games/search-and-destroy-match/",
                },
              ],
            },
            { label: "Creative", link: "/creative/" },
            { label: "Creative plots", link: "/creative-plots/" },
            {
              label: "Creative plot maintenance",
              link: "/creative-plot-maintenance/",
            },
            { label: "Creative plot copies", link: "/creative-plot-copies/" },
          ],
        },
        {
          label: "Command reference",
          collapsed: true,
          items: [
            { label: "Travel", link: "/commands/travel/" },
            { label: "Camps and towns", link: "/commands/camps-and-towns/" },
            {
              label: "Claims, locks, and PvP",
              link: "/commands/claims-locks-and-pvp/",
            },
            { label: "Graves", link: "/commands/graves/" },
            {
              label: "Crystals and shops",
              link: "/commands/crystals-and-shops/",
            },
            {
              label: "Sorting and banks",
              link: "/commands/sorting-and-banks/",
            },
            { label: "Progression", link: "/commands/progression/" },
            { label: "Quests", link: "/commands/quests/" },
            { label: "Games", link: "/commands/games/" },
            { label: "Creative", link: "/commands/creative/" },
            {
              label: "Chat and settings",
              link: "/commands/chat-and-settings/",
            },
            { label: "Mail and Discord", link: "/commands/mail-and-discord/" },
            { label: "Help and tickets", link: "/commands/help-and-tickets/" },
          ],
        },
        {
          label: "Community",
          collapsed: true,
          items: [
            { label: "Norms", link: "/norms/" },
            { label: "Common commands", link: "/community/commands/" },
            {
              label: "Help with common problems",
              link: "/community/help-with-common-problems/",
            },
            { label: "Chat and mail", link: "/community/chat-and-mail/" },
            { label: "Discord", link: "/discord/" },
          ],
        },
      ],
      social: [
        {
          href: "https://github.com/orgs/the-storm-mc/repositories",
          icon: "github",
          label: "The Storm on GitHub",
        },
        {
          href: "https://discord.gg/TvTCcWnYUT",
          icon: "discord",
          label: "The Storm Discord",
        },
      ],
      title: "The Storm",
    }),
  ],
  output: "static",
  site: "https://docs.ts-mc.net",
  trailingSlash: "always",
});
