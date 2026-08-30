import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { scoutAssetsPlugin } from "@scout-for-lol/design-system/build";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/customs/",
  plugins: [react(), tailwindcss(), scoutAssetsPlugin()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5181,
    proxy: {
      "/trpc": "http://localhost:3000",
      "/api": { target: "http://localhost:3000", ws: true },
    },
  },
});
