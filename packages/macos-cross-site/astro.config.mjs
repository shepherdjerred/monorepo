// @ts-check
import { defineConfig } from "astro/config";
import icon from "astro-icon";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  compressHTML: true,
  integrations: [icon()],
  vite: {
    plugins: [tailwindcss()],
  },
});
