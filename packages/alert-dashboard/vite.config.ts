import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const env = loadEnv("development", ".", "");
const vitePort = Number(env["PORT"] ?? "7342");
const apiPort = Number(
  env["API_PORT"] ??
    (env["PORT"] === undefined ? "7341" : String(vitePort + 1)),
);
const apiTarget = `http://127.0.0.1:${String(apiPort)}`;

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist/client", emptyOutDir: true, sourcemap: true },
  server: {
    host: "127.0.0.1",
    port: vitePort,
    strictPort: true,
    proxy: {
      "/trpc": apiTarget,
      "/api": apiTarget,
    },
  },
});
