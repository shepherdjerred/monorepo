import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { fileURLToPath } from "node:url";
import { webPage } from "./src/web/server/assets.ts";

/** Serves each browser route's page in development the way the production server does. */
const pages: Plugin = {
  name: "streambot-pages",
  configureServer(server) {
    server.middlewares.use((request, _response, next) => {
      const url = new URL(request.url ?? "/", "http://dev");
      const page = webPage(url.pathname);
      if (page !== null) request.url = page + url.search;
      next();
    });
  },
};

const web = (path: string) =>
  fileURLToPath(new URL("src/web/" + path, import.meta.url));

/**
 * One build serves two pages until the classic remote is removed: the new client at `/` and the
 * classic client at `/classic`. Both share `/assets/` and `src/web/public/`.
 */
export default defineConfig({
  root: web(""),
  publicDir: web("public"),
  plugins: [react(), pages],
  resolve: {
    alias: {
      "@shepherdjerred/streambot": fileURLToPath(
        new URL("src", import.meta.url),
      ),
    },
  },
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        client: web("client/index.html"),
        classic: web("client-classic/index.html"),
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5187,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:8080" },
  },
});
