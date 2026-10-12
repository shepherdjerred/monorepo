import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://glitter-boys.com",
  output: "static",
  trailingSlash: "always",
  build: { format: "directory" },
  integrations: [
    sitemap(),
    starlight({
      title: "Glitter Boys",
      favicon: "/favicon.svg",
      description: "Game setup guides for the Glitter Boys.",
      customCss: ["./src/styles/docs.css"],
      components: { SiteTitle: "./src/components/DocsTitle.astro" },
      pagefind: true,
      sidebar: [
        { label: "Start here", link: "/docs/" },
        { label: "Windows launcher", link: "/docs/launcher/" },
        {
          label: "Mac + Windows crossplay",
          items: [
            { label: "Overview & compatibility", link: "/docs/crossplay/" },
            { label: "Windows setup", link: "/docs/crossplay/windows/" },
            {
              label: "BO3 Steam + T7Patch",
              link: "/docs/crossplay/windows/bo3/",
            },
            {
              label: "macOS setup (Apple silicon)",
              link: "/docs/crossplay/macos/",
            },
            { label: "Play together", link: "/docs/crossplay/play-together/" },
          ],
        },
        {
          label: "Advanced: manual Windows setup",
          items: [
            { label: "Modern Warfare 2", link: "/docs/iw4/" },
            { label: "World at War", link: "/docs/t4/" },
            { label: "Black Ops", link: "/docs/t5/" },
            { label: "Black Ops II", link: "/docs/t6/" },
            { label: "Black Ops III", link: "/docs/t7/" },
          ],
        },
      ],
    }),
  ],
});
