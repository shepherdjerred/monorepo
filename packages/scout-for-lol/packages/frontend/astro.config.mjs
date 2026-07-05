// @ts-check
import { defineConfig, envField } from "astro/config";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "node:fs";

import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import icon from "astro-icon";
import sitemap from "@astrojs/sitemap";
import astroOpenGraphImages from "astro-opengraph-images";
import { ogTemplate } from "./src/lib/og-template.tsx";

const dirname = fileURLToPath(new URL(".", import.meta.url));

const beaufortBold = readFileSync(
  resolve(dirname, "public/fonts/BeaufortForLoL-TTF/BeaufortforLOL-Bold.ttf"),
);
const spiegelRegular = readFileSync(
  resolve(dirname, "public/fonts/Spiegel-TTF/Spiegel_TT_Regular.ttf"),
);
const spiegelSemiBold = readFileSync(
  resolve(dirname, "public/fonts/Spiegel-TTF/Spiegel_TT_SemiBold.ttf"),
);

// Pages that are noindex (dashboard SPA + dev tooling) — excluded from the
// sitemap. They still receive a generated OG image (harmless; they carry the
// required og:* tags via SeoHead so the OG extractor doesn't error).
const isNoindexPath = (/** @type {string} */ page) =>
  /\/(app|dev)\//.test(page) || page.endsWith("/app") || page.endsWith("/dev");

// https://astro.build/config
export default defineConfig({
  site: "https://scout-for-lol.com",
  env: {
    schema: {
      PUBLIC_PINTEREST_TAG_ID: envField.string({
        context: "client",
        access: "public",
      }),
      PUBLIC_REDDIT_PIXEL_ID: envField.string({
        context: "client",
        access: "public",
      }),
      // Injected at build time by the CI site-deploy step (2.0.0-<build>).
      // Optional: unset in local/dev builds, where Sentry release stays undefined.
      PUBLIC_SENTRY_RELEASE: envField.string({
        context: "client",
        access: "public",
        optional: true,
      }),
    },
  },
  integrations: [
    mdx(),
    react(),
    icon(),
    sitemap({ filter: (page) => !isNoindexPath(page) }),
    astroOpenGraphImages({
      options: {
        fonts: [
          {
            name: "Beaufort for LoL",
            weight: 700,
            style: "normal",
            data: beaufortBold,
          },
          {
            name: "Spiegel",
            weight: 400,
            style: "normal",
            data: spiegelRegular,
          },
          {
            name: "Spiegel",
            weight: 600,
            style: "normal",
            data: spiegelSemiBold,
          },
        ],
      },
      render: ogTemplate,
    }),
  ],
  vite: {
    assetsInclude: ["**/*.txt"],
    optimizeDeps: {
      // Don't pre-bundle these native modules - they're only used server-side
      exclude: ["@resvg/resvg-js", "satori"],
    },
    resolve: {
      alias: {
        // Replace resvg with a stub when importing in browser
        "@resvg/resvg-js": resolve(dirname, "src/resvg-stub.ts"),
        // Replace satori with a stub when importing in browser
        satori: resolve(dirname, "src/satori-stub.ts"),
        // Replace Node.js built-ins with empty modules for browser
        assert: resolve(dirname, "src/assert-stub.ts"),
      },
    },
  },
});
