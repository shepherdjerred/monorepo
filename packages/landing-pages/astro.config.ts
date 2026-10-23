import { defineConfig } from "astro/config";

export default defineConfig({
  devToolbar: { enabled: false },
  output: "static",
  site: "https://pages.sjer.red",
  trailingSlash: "always",
  build: { format: "directory" },
});
