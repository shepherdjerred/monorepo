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
            { label: "Choosing a Backend", slug: "getting-started/backends" },
            { label: "Choosing an Agent", slug: "getting-started/agents" },
          ],
        },
        {
          label: "Core Concepts",
          items: [
            { label: "Zero-Credential Proxy", slug: "guides/proxy" },
            { label: "Access Modes", slug: "guides/access-modes" },
          ],
        },
        {
          label: "User Interfaces",
          items: [
            { label: "Command Line (CLI)", slug: "reference/cli" },
            { label: "Terminal UI (TUI)", slug: "user-interfaces/tui" },
            { label: "Web Interface", slug: "guides/web-ui" },
            {
              label: "Mobile Apps",
              items: [
                { label: "Overview", slug: "mobile/overview" },
                { label: "Setup", slug: "mobile/setup" },
              ],
            },
          ],
        },
        {
          label: "Backends",
          items: [
            { label: "Docker", slug: "guides/docker" },
            { label: "Kubernetes", slug: "guides/kubernetes" },
            { label: "Zellij", slug: "guides/zellij" },
            { label: "Sprites", slug: "guides/sprites" },
            { label: "Apple Container", slug: "guides/apple-container" },
            { label: "Custom Images", slug: "guides/custom-images" },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "Using Hooks", slug: "guides/hooks" },
            { label: "1Password Integration", slug: "guides/onepassword" },
            { label: "Multi-Repository Sessions", slug: "guides/multi-repo" },
            { label: "Model Selection", slug: "guides/model-selection" },
            { label: "Resource Health & Reconciliation", slug: "guides/health-reconciliation" },
            { label: "Performance Tuning", slug: "guides/performance" },
            { label: "Troubleshooting", slug: "guides/troubleshooting" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "CLI Commands", slug: "reference/cli" },
            { label: "API", slug: "reference/api" },
            { label: "Configuration", slug: "reference/configuration" },
            { label: "Configuration Audit", slug: "reference/configuration-audit" },
            { label: "Environment Variables", slug: "reference/environment-variables" },
            { label: "File Locations", slug: "reference/file-locations" },
            { label: "Feature Flags", slug: "reference/feature-flags" },
            { label: "Feature Parity", slug: "reference/feature-parity" },
            { label: "Test Coverage", slug: "reference/test-coverage" },
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
