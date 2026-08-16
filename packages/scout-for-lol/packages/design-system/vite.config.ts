import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { scoutAssetsPlugin } from "./src/build/index.ts";

export default defineConfig({
  plugins: [react(), scoutAssetsPlugin({ emit: true })],
  build: { outDir: "dist", emptyOutDir: true },
  server: { port: 5190 },
});
