import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist/client", emptyOutDir: true, sourcemap: true },
  server: {
    host: "127.0.0.1",
    port: 7371,
    strictPort: true,
    proxy: Object.fromEntries(
      ["/api", "/charts", "/index.yaml", "/healthz", "/readyz", "/metrics"].map(
        (route) => [route, "http://127.0.0.1:7370"],
      ),
    ),
  },
});
