import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The watcher (packages/pr-fleet-controller/src/watch-server.ts) serves this
// built bundle from `dist/` and exposes `/api/*`. In dev, proxy those to a
// running `pr:fleet:watch` instance.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    host: "127.0.0.1",
    port: 7350,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:7788",
        changeOrigin: true,
      },
    },
  },
});
