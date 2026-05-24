import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://stocks.sjer.red",
  prefetch: true,
  vite: {
    plugins: [tailwindcss()],
  },
});
