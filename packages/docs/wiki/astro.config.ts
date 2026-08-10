import { satteri } from "@astrojs/markdown-satteri";
import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import mermaid from "astro-mermaid";

import { wikiLinksPlugin } from "./src/lib/wiki-links.ts";

const wikiRoot = new URL("./", import.meta.url).pathname;

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
    sitemap(),
    starlight({
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
          items: [{ autogenerate: { directory: "tutorials" } }],
          label: "Tutorials",
        },
        {
          items: [{ autogenerate: { directory: "how-to" } }],
          label: "How-to guides",
        },
        {
          items: [{ autogenerate: { directory: "reference" } }],
          label: "Reference",
        },
        {
          items: [{ autogenerate: { directory: "explanation" } }],
          label: "Concepts",
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
      mdastPlugins: [wikiLinksPlugin(wikiRoot)],
    }),
  },
  output: "static",
  // Routes that were published before the wiki was restructured on Diátaxis,
  // plus canonical post-restructure routes whose page has since been retired.
  // Both are linked from pull requests and possibly bookmarked, so they
  // redirect rather than 404.
  redirects: {
    "/birmel": "/explanation/birmel/",
    // Plane was retired; preserve its old routes by redirecting them to the
    // current homelab overview.
    "/explanation/homelab/plane": "/explanation/homelab/overview/",
    "/homelab/alerts": "/explanation/homelab/alerts/",
    "/homelab/buildkite-admission": "/explanation/homelab/buildkite-admission/",
    "/homelab/plane": "/explanation/homelab/overview/",
    "/homelab/releases": "/explanation/homelab/release-safety/",
    "/homelab/scout-evals-tailnet-boundary":
      "/explanation/homelab/scout-evals-trust-boundary/",
    "/homelab/tracker-tracker": "/explanation/homelab/tracker-tracker/",
    "/how-this-wiki-works": "/explanation/how-this-wiki-works/",
    "/pr-fleet-controller": "/explanation/pr-fleet-authority-boundary/",
    "/scout-analysis": "/explanation/scout-temporal-analysis/",
    "/starlight-karma-bot": "/explanation/starlight-karma-bot/",
    "/streambot-voice": "/explanation/streambot-voice/",
    "/tasks-for-obsidian": "/explanation/tasks-for-obsidian/",
    "/temporal": "/explanation/temporal/overview/",
    "/temporal/agent-tasks": "/explanation/temporal/agent-task-boundary/",
    "/temporal/events": "/explanation/temporal/event-surfaces/",
    "/temporal/schedules": "/reference/temporal-schedules/",
    "/temporal/workflows": "/reference/temporal-workflows/",
    "/temporal/workflows/glitter": "/explanation/temporal/workflow-families/",
    "/temporal/workflows/home-automation":
      "/reference/home-automation-routines/",
    "/temporal/workflows/homelab-maintenance":
      "/explanation/temporal/workflow-families/",
    "/temporal/workflows/pr-bots": "/explanation/temporal/event-surfaces/",
    "/temporal/workflows/repo-upkeep":
      "/explanation/temporal/workflow-families/",
    "/temporal/workflows/scout": "/explanation/temporal/workflow-families/",
  },
  prefetch: {
    defaultStrategy: "hover",
    prefetchAll: true,
  },
  site: "https://wiki.sjer.red",
  trailingSlash: "always",
});
