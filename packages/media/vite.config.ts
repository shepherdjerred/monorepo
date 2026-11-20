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
  build: { outDir: "dist", emptyOutDir: true, sourcemap: true },
  server: {
    host: "127.0.0.1",
    port: 7358,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:7357" },
  },
});
