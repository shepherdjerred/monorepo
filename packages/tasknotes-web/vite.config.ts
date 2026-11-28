import { env } from "node:process";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { offlineShellPlugin } from "./offline-shell-plugin.ts";

const serverOrigin = env["TASKNOTES_SERVER_ORIGIN"] ?? "http://127.0.0.1:3000";

// A leading dot allows that suffix and its subdomains. Tailscale Serve sends
// the MagicDNS host, and an empty allow-list would reject it.
const tailnetHosts = [".ts.net"];

export default defineConfig({
  plugins: [react(), offlineShellPlugin()],
  build: { outDir: "dist", emptyOutDir: true, sourcemap: true },
  server: {
    host: "127.0.0.1",
    port: 4187,
    strictPort: true,
    allowedHosts: tailnetHosts,
    proxy: { "/api": serverOrigin },
  },
  preview: {
    host: "127.0.0.1",
    port: 4187,
    strictPort: true,
    allowedHosts: tailnetHosts,
    proxy: { "/api": serverOrigin },
  },
});
