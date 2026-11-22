import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Lightning CSS transforms the stylesheets in development and in the
  // build. Its targets (`css.lightningcss.targets`) are left at Vite's
  // default, Baseline Widely available. The tokens are written with
  // light-dark(), which is newer than that; this pass rewrites it into custom
  // properties every targeted browser supports. Newer targets would ship the
  // function as written, and the browser suite fails when the built
  // stylesheet still contains it.
  css: { transformer: "lightningcss" },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    // One stylesheet for the whole client, although the owner's pages are
    // separate script chunks: a browser fixes the cascade layer order at the
    // first `@layer` it reads, and a single sheet always opens with it.
    cssCodeSplit: false,
    // Every asset is its own file, however small: the Content-Security-Policy
    // (`src/server/static/security-headers.ts`) allows no `data:` URL.
    assetsInlineLimit: 0,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              // zod and the module that configures it are one chunk, which
              // every chunk that builds a schema imports. A chunk runs after
              // the chunks it imports, so without this group the entry
              // chunk's configuration would run after the shared chunks had
              // already built their schemas (see `src/client/startup/zod.ts`).
              name: "zod",
              test: /\/node_modules\/zod\/|\/src\/client\/startup\/zod\.ts$/u,
            },
            {
              // The sheet that declares the cascade layer order is its own
              // chunk, which the entry imports before any other. A component
              // stylesheet shared by the entry and a lazy route sits in a
              // shared chunk, and a shared chunk's styles are written before
              // the entry's own; without this group such a sheet would open
              // the bundle and the browser would fix `components` first.
              name: "layers",
              test: /\/src\/client\/styles\.css$|\/src\/client\/styles\/[^/]+\.css$/u,
            },
          ],
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 7358,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:7357" },
  },
});
