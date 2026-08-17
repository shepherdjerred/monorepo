import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { scoutAssetsPlugin } from "@scout-for-lol/design-system/build";

// The SPA is served at /app/ on scout-for-lol.com behind a reverse proxy
// that also routes /trpc/* and /api/* to the backend on the same origin.
// Production assets are emitted under /app/assets/ via the `base` option.
export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "");
  const backendOrigin =
    environment["SCOUT_DEV_BACKEND_URL"] ?? "http://localhost:3000";

  return {
    base: "/app/",
    plugins: [react(), tailwindcss(), scoutAssetsPlugin()],
    build: {
      outDir: "dist",
      emptyOutDir: true,
      sourcemap: true,
    },
    server: {
      port: 5180,
      proxy: {
        "/trpc": backendOrigin,
        "/api": backendOrigin,
      },
    },
  };
});
