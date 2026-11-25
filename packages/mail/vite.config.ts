import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist/client", emptyOutDir: true, sourcemap: true },
  server: {
    host: "127.0.0.1",
    port: 7373,
    strictPort: true,
    proxy: {
      "/healthz": "http://127.0.0.1:7370",
      "/readyz": "http://127.0.0.1:7370",
      "/metrics": "http://127.0.0.1:7370",
      "/api": "http://127.0.0.1:7370",
    },
  },
});
