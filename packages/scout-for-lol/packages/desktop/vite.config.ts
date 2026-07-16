import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import pkg from "./package.json";

const host: string | undefined =
  typeof process.env["TAURI_DEV_HOST"] === "string"
    ? process.env["TAURI_DEV_HOST"]
    : undefined;
const isDebug = Boolean(process.env["TAURI_DEBUG"]);

// https://vitejs.dev/config/
export default defineConfig({
  // Inlined into the bundle so Sentry.init can tag events with a release.
  // Desktop has no CI-injected version, so the app's package version is the
  // meaningful release identifier (bumped when a desktop build is cut).
  define: {
    BUILD_SENTRY_RELEASE: JSON.stringify(`scout-desktop@${pkg.version}`),
  },
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
    ...(host !== undefined && host.length > 0
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
