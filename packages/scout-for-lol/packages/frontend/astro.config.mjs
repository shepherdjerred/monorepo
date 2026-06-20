// @ts-check
import { defineConfig, envField } from "astro/config";
import { resolve } from "path";
import { fileURLToPath } from "url";

import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import icon from "astro-icon";

const dirname = fileURLToPath(new URL(".", import.meta.url));

// https://astro.build/config
export default defineConfig({
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
  integrations: [mdx(), react(), icon()],
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
