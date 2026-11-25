import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist/client", emptyOutDir: true, sourcemap: true },
  server: {
    host: "127.0.0.1",
    port: 7432,
    strictPort: true,
    proxy: {
      "/healthz": "http://127.0.0.1:7430",
      "/api": "http://127.0.0.1:7430",
    },
  },
});
