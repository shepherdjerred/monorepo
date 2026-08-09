import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import Unfonts from "unplugin-fonts/vite";
import Icons from "unplugin-icons/vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  optimizeDeps: {
    esbuildOptions: {
      target: "es2020",
    },
  },
  server: {
    proxy: {
      // The driver feed is same-origin in production (Express serves this
      // bundle), but under `vite dev` the page is on 5173 and the backend on
      // 8081, so the upgrade has to be forwarded explicitly.
      "/video": { target: "ws://localhost:8081", ws: true },
    },
  },
  plugins: [
    react(),
    Icons({ compiler: "jsx", jsx: "react" }),
    Unfonts({
      google: {
        preconnect: true,
        families: [
          {
            name: "Inter",
          },
        ],
      },
    }),
    tailwindcss(),
  ],
});
