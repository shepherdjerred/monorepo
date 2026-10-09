import { satteri } from "@astrojs/markdown-satteri";
import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import mermaid from "astro-mermaid";

import { wikiLinksPlugin } from "./src/lib/wiki-links.ts";
import { wikiRedirects } from "./src/lib/wiki-redirects.ts";

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
      head: [
        {
          tag: "script",
          attrs: { src: "/posthog.js", defer: true },
        },
      ],
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
  redirects: wikiRedirects,
  prefetch: {
    defaultStrategy: "hover",
    prefetchAll: true,
  },
  site: "https://wiki.sjer.red",
  trailingSlash: "always",
});
