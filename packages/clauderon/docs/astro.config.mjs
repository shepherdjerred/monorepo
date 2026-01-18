import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://clauderon.dev",
  integrations: [
    starlight({
      title: "clauderon",
      description: "Session management for AI coding agents",
      social: {
        github: "https://github.com/shepherdjerred/monorepo/tree/main/packages/clauderon",
      },
      logo: {
        light: "./src/assets/logo-light.svg",
        dark: "./src/assets/logo-dark.svg",
        replacesTitle: true,
      },
      customCss: ["./src/styles/custom.css"],
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Introduction", slug: "getting-started/introduction" },
            { label: "Installation", slug: "getting-started/installation" },
            { label: "Quick Start", slug: "getting-started/quick-start" },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "Docker Backend", slug: "guides/docker" },
            { label: "Zellij Backend", slug: "guides/zellij" },
            { label: "Credential Proxy", slug: "guides/proxy" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "CLI Commands", slug: "reference/cli" },
            { label: "Configuration", slug: "reference/configuration" },
          ],
        },
      ],
      head: [
        {
          tag: "meta",
          attrs: {
            property: "og:image",
            content: "/og-image.png",
          },
        },
      ],
    }),
  ],
});
