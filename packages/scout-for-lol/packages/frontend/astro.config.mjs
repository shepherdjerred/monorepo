// @ts-check
import { defineConfig } from "astro/config";
import { resolve } from "path";
import { fileURLToPath } from "url";

import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import icon from "astro-icon";

const dirname = fileURLToPath(new URL(".", import.meta.url));

// https://astro.build/config
export default defineConfig({
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
