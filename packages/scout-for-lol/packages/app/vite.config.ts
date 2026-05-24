import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The SPA is served at /app/ on scout-for-lol.com behind a reverse proxy
// that also routes /trpc/* and /api/* to the backend on the same origin.
// Production assets are emitted under /app/assets/ via the `base` option.
export default defineConfig({
  base: "/app/",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5180,
    proxy: {
      "/trpc": "http://localhost:3000",
      "/api": "http://localhost:3000",
    },
  },
});
