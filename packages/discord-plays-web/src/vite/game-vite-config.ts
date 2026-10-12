import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import Icons from "unplugin-icons/vite";
import { defineConfig, type PluginOption, type UserConfig } from "vite";

export type GameViteConfigOptions = {
  /** The game backend's web port, which `vite dev` proxies to. */
  readonly backendPort: number;
  /** Extra plugins, e.g. a game's font loader. */
  readonly plugins?: PluginOption[];
};

/**
 * The Vite config both game frontends share.
 *
 * In production Express serves the built bundle, so Socket.IO, the driver feed,
 * and the HTTP API are same-origin. Under `vite dev` the page is on 5173 and
 * the backend on its own port, so each of those paths is proxied explicitly.
 */
export function defineGameViteConfig({
  backendPort,
  plugins = [],
}: GameViteConfigOptions): UserConfig {
  const http = `http://localhost:${String(backendPort)}`;
  const ws = `ws://localhost:${String(backendPort)}`;
  return defineConfig({
    // The game and this package each depend on React; one copy must win or
    // hooks break across the package boundary.
    resolve: {
      dedupe: ["react", "react-dom"],
    },
    optimizeDeps: {
      esbuildOptions: {
        target: "es2020",
      },
    },
    server: {
      proxy: {
        "/socket.io": { target: ws, ws: true },
        "/video": { target: ws, ws: true },
        "/api": { target: http },
      },
    },
    plugins: [
      react(),
      Icons({ compiler: "jsx", jsx: "react" }),
      tailwindcss(),
      ...plugins,
    ],
  });
}
