import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  build: {
    format: "directory",
  },
  integrations: [
    sitemap(),
    starlight({
      customCss: ["./src/styles/custom.css"],
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
          attrs: {
            property: "og:image",
            content: "https://docs.ts-mc.net/social.png",
          },
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
            { label: "Live Map", link: "/survival/livemap/" },
            { label: "Worlds", link: "/survival/worlds/" },
            { label: "Transparency", link: "/survival/transparency/" },
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
