import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://clauderon.com",
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
            { label: "Backends", slug: "getting-started/backends" },
            { label: "Agents", slug: "getting-started/agents" },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "Web Interface", slug: "guides/web-ui" },
            { label: "Credential Proxy", slug: "guides/proxy" },
            { label: "1Password", slug: "guides/onepassword" },
            { label: "Access Modes", slug: "guides/access-modes" },
            { label: "Hooks", slug: "guides/hooks" },
            {
              label: "Backends",
              items: [
                { label: "Zellij", slug: "guides/zellij" },
                { label: "Docker", slug: "guides/docker" },
                { label: "Custom Images", slug: "guides/custom-images" },
                { label: "Kubernetes", slug: "guides/kubernetes" },
                { label: "Sprites", slug: "guides/sprites" },
                { label: "Apple Container", slug: "guides/apple-container" },
              ],
            },
            { label: "Troubleshooting", slug: "guides/troubleshooting" },
          ],
        },
        {
          label: "Mobile",
          items: [
            { label: "Overview", slug: "mobile/overview" },
            { label: "Setup", slug: "mobile/setup" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "CLI Commands", slug: "reference/cli" },
            { label: "Configuration", slug: "reference/configuration" },
            { label: "Configuration Audit", slug: "reference/configuration-audit" },
            { label: "API", slug: "reference/api" },
            { label: "Environment Variables", slug: "reference/environment-variables" },
            { label: "File Locations", slug: "reference/file-locations" },
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
        {
          tag: "script",
          attrs: {
            defer: true,
            "data-domain": "clauderon.com",
            src: "https://plausible.sjer.red/js/script.js",
          },
        },
      ],
    }),
  ],
});
