import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The app host serves `dist/client` (see `src/server/`). In development the
 * Vite server proxies the API to a running service on 7440.
 */
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist/client", emptyOutDir: true, sourcemap: true },
  worker: { format: "es" },
  server: {
    host: "127.0.0.1",
    port: 7441,
    strictPort: true,
    proxy: Object.fromEntries(
      ["/trpc", "/api", "/agent"].map((route) => [
        route,
        "http://127.0.0.1:7440",
      ]),
    ),
  },
});
