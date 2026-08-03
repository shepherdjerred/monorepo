import { satteri } from "@astrojs/markdown-satteri";
import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import mermaid from "astro-mermaid";

import { wikiLinksPlugin } from "./src/lib/wiki-links.ts";

const docsRoot = new URL("../", import.meta.url).pathname;

export default defineConfig({
  build: {
    format: "directory",
    inlineStylesheets: "never",
  },
  image: {
    layout: "constrained",
    responsiveStyles: true,
  },
  integrations: [
    mermaid({
      autoTheme: true,
      enableLog: false,
      mermaidConfig: {
        securityLevel: "strict",
      },
    }),
    sitemap({
      filter: (page) => !new URL(page).pathname.startsWith("/working/"),
    }),
    starlight({
      components: {
        MarkdownContent: "./src/components/markdown-content.astro",
        PageTitle: "./src/components/page-title.astro",
      },
      customCss: ["./src/styles/custom.css"],
      description:
        "A terse, visual map of Jerred's monorepo, infrastructure, and engineering decisions.",
      editLink: {
        baseUrl:
          "https://github.com/shepherdjerred/monorepo/edit/main/packages/docs/wiki/",
      },
      favicon: "/favicon.svg",
      lastUpdated: true,
      markdown: {
        processedDirs: [".."],
      },
      pagefind: true,
      sidebar: [
        {
          items: [
            { label: "Start here", link: "/" },
            { label: "How this wiki works", link: "/how-this-wiki-works/" },
            { label: "Working material", link: "/working/" },
          ],
          label: "Wiki",
        },
        {
          items: [
            {
              label: "PR Fleet Controller",
              link: "/pr-fleet-controller/",
            },
          ],
          label: "Tooling",
        },
        {
          items: [
            {
              label: "qBittorrent VPN webseed relay",
              link: "/homelab/qbittorrent-vpn-webseed-relay/",
            },
            {
              label: "Scout evals tailnet boundary",
              link: "/homelab/scout-evals-tailnet-boundary/",
            },
          ],
          label: "Homelab",
        },
        {
          items: [
            { label: "Overview", link: "/temporal/" },
            { label: "Scheduled automations", link: "/temporal/schedules/" },
            { label: "Agent tasks", link: "/temporal/agent-tasks/" },
            { label: "Event-driven surfaces", link: "/temporal/events/" },
            {
              collapsed: true,
              items: [
                { label: "Inventory", link: "/temporal/workflows/" },
                {
                  label: "Repo upkeep",
                  link: "/temporal/workflows/repo-upkeep/",
                },
                { label: "Scout", link: "/temporal/workflows/scout/" },
                { label: "Glitter", link: "/temporal/workflows/glitter/" },
                {
                  label: "Homelab maintenance",
                  link: "/temporal/workflows/homelab-maintenance/",
                },
                {
                  label: "Home automation",
                  link: "/temporal/workflows/home-automation/",
                },
                { label: "GitHub PRs", link: "/temporal/workflows/pr-bots/" },
              ],
              label: "Workflows",
            },
          ],
          label: "Temporal",
        },
      ],
      social: [
        {
          href: "https://github.com/shepherdjerred/monorepo",
          icon: "github",
          label: "Monorepo on GitHub",
        },
      ],
      title: "Jerred's Systems Wiki",
    }),
  ],
  markdown: {
    processor: satteri({
      mdastPlugins: [wikiLinksPlugin(docsRoot)],
    }),
  },
  output: "static",
  prefetch: {
    defaultStrategy: "hover",
    prefetchAll: true,
  },
  site: "https://wiki.sjer.red",
  trailingSlash: "always",
});
