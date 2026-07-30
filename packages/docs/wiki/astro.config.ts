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
