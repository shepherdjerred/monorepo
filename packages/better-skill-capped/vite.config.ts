import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // The deployed bucket's /data/manifest.json is written by a Temporal
    // workflow; local dev has no manifest source, so proxy to production.
    proxy: {
      "/data": {
        target: "https://better-skill-capped.com",
        changeOrigin: true,
      },
    },
  },
});
