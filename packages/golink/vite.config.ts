import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist/client", emptyOutDir: true, sourcemap: true },
  server: {
    host: "127.0.0.1",
    port: 7359,
    proxy: Object.fromEntries(
      ["/api", "/.export", "/healthz", "/readyz"].map((route) => [
        route,
        "http://127.0.0.1:7352",
      ]),
    ),
  },
});
