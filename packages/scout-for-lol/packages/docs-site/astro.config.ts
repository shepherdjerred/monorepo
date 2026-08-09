import { env } from "node:process";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

const siteOrigin = env.PUBLIC_DOCS_SITE_ORIGIN ?? "https://scout-for-lol.com";

/**
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
  image: {
    layout: "constrained",
    responsiveStyles: true,
  },
  integrations: [
    sitemap(),
    starlight({
      description:
        "Learn how to install, configure, and get the most from Scout for League of Legends.",
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
});
