import { env } from "node:process";
import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import { scoutAssetsPlugin } from "@scout-for-lol/design-system/build";

const siteOrigin = env.PUBLIC_DOCS_SITE_ORIGIN ?? "https://scout-for-lol.com";
const posthogHeadAttrs = {
  "data-posthog-project-token": env.PUBLIC_POSTHOG_PROJECT_TOKEN,
  "data-posthog-api-host": env.PUBLIC_POSTHOG_API_HOST,
  "data-posthog-asset-host": env.PUBLIC_POSTHOG_ASSET_HOST,
  "data-posthog-site-key": env.PUBLIC_POSTHOG_SITE_KEY,
  "data-posthog-site-domain": env.PUBLIC_POSTHOG_SITE_DOMAIN,
  "data-posthog-session-replay": env.PUBLIC_POSTHOG_SESSION_REPLAY,
};

/**
 * Expressive Code options live in `ec.config.mjs`, not here: the ScoutQL
 * highlighting plugin is a function, and Starlight's `<Code>` component
 * re-creates the renderer from a JSON copy of this config, so a plugin
 * configured here fails the build with "Expressive Code options that are not
 * serializable to JSON".
 *
 * Sidebar links are resolved through Starlight's `pathWithBase()`, which
 * prepends `base` ("/docs/") on its own. Every group below therefore uses
 * `autogenerate`, and ordering comes from each page's `sidebar.order`
 * frontmatter — hand-written `link` values would have to omit the `/docs`
 * prefix, and getting that wrong silently produces `/docs/docs/...` 404s.
 */
export default defineConfig({
  base: "/docs/",
  build: {
    format: "directory",
    inlineStylesheets: "never",
  },
  devToolbar: { enabled: env.CI !== "true" },
  image: {
    layout: "constrained",
    responsiveStyles: true,
  },
  integrations: [
    sitemap(),
    react(),
    starlight({
      components: {
        Footer: "./src/components/overrides/Footer.astro",
        Header: "./src/components/overrides/Header.astro",
        ThemeProvider: "./src/components/overrides/ThemeProvider.astro",
        ThemeSelect: "./src/components/overrides/ThemeSelect.astro",
      },
      customCss: ["./src/styles/scout.css"],
      description:
        "Learn how to install, configure, and get the most from Scout for League of Legends.",
      favicon: "/assets/scout/brand/emblem.svg",
      head: [
        {
          tag: "script",
          attrs: {
            ...posthogHeadAttrs,
            defer: true,
            src: "/docs/posthog-bootstrap.js",
          },
        },
      ],
      lastUpdated: true,
      pagefind: true,
      sidebar: [
        {
          label: "Tutorials",
          items: [{ autogenerate: { directory: "tutorials" } }],
        },
        {
          label: "How-to guides",
          items: [{ autogenerate: { directory: "how-to" } }],
        },
        {
          label: "Reference",
          items: [{ autogenerate: { directory: "reference" } }],
        },
        {
          label: "Concepts",
          items: [{ autogenerate: { directory: "explanation" } }],
        },
      ],
      title: "Scout for LoL Docs",
    }),
    // Must come after starlight(): Starlight registers astro-expressive-code,
    // which requires that it be set up before mdx().
    mdx(),
  ],
  output: "static",
  site: siteOrigin,
  trailingSlash: "always",
  vite: { plugins: [scoutAssetsPlugin()] },
});
