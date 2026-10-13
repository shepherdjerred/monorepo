import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist/client", emptyOutDir: true, sourcemap: true },
  server: {
    host: "127.0.0.1",
    port: 7352,
    strictPort: true,
    proxy: Object.fromEntries(
      ["/trpc", "/api", "/attachments", "/avatars"].map((route) => [
        route,
        "http://127.0.0.1:7351",
      ]),
    ),
  },
});
