import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist/client", sourcemap: true },
  server: {
    host: "127.0.0.1",
    port: 7354,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:7353" },
  },
});
