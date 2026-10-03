import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: "src/web/client",
  plugins: [react()],
  resolve: {
    alias: {
      "@shepherdjerred/streambot": fileURLToPath(
        new URL("src", import.meta.url),
      ),
    },
  },
  build: { outDir: "../../../dist/web", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: 5187,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:8080" },
  },
});
