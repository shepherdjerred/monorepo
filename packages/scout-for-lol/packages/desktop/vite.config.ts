/* eslint-disable custom-rules/prefer-bun-apis -- Vite config runs in Node context, not Bun */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

const host: string | undefined =
  typeof process.env["TAURI_DEV_HOST"] === "string"
    ? process.env["TAURI_DEV_HOST"]
    : undefined;
const isDebug = Boolean(process.env["TAURI_DEBUG"]);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  resolve: {
    alias: {
      "@": `${import.meta.dirname}/src`,
      "@scout-for-lol/desktop": `${import.meta.dirname}/src`,
    },
  },
  clearScreen: false,
  server: {
    host: host ?? false,
    port: 5173,
    strictPort: true,
    ...(host
      ? {
          hmr: {
            protocol: "ws",
            host,
            port: 5173,
          },
        }
      : {}),
  },
  build: {
    outDir: "dist",
    target: "esnext",
    minify: isDebug ? false : "esbuild",
    sourcemap: isDebug,
  },
});
