import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/trpc": "http://localhost:3000",
      "/api": "http://localhost:3000",
    },
  },
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
  },
});
