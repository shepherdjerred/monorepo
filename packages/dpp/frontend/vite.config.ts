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
