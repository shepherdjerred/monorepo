import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  devToolbar: { enabled: false },
  build: {
    format: "directory",
  },
  integrations: [
    sitemap(),
    starlight({
      customCss: ["../storm-theme/src/styles.css", "./src/styles/custom.css"],
      components: {
        Head: "./src/components/Head.astro",
        Header: "./src/components/Header.astro",
        ThemeProvider: "./src/components/ThemeProvider.astro",
        ThemeSelect: "./src/components/ThemeSelect.astro",
      },
      description: "Documentation for The Storm Minecraft server.",
      editLink: {
        baseUrl:
          "https://github.com/shepherdjerred/monorepo/edit/main/packages/ts-mc-docs/",
      },
      favicon: "/favicon.svg",
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
        src: "./src/assets/storm-mark.svg",
        alt: "The Storm",
      },
      pagefind: true,
      sidebar: [
        { label: "Welcome", link: "/" },
        { label: "Norms", link: "/norms/" },
        { label: "World Downloads", link: "/world_downloads/" },
        {
          label: "Survival",
          items: [
            { label: "Overview", link: "/survival/" },
            { label: "LiveMap", link: "/survival/livemap/" },
            { label: "Worlds", link: "/survival/worlds/" },
            { label: "Transparency", link: "/survival/transparency/" },
          ],
        },
        { label: "Search and Destroy", link: "/search-and-destroy/" },
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
