import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { scoutAssetsPlugin } from "@scout-for-lol/design-system/build";

// Storybook's builder is pointed here rather than at the SPA's vite.config.ts,
// which carries three things a catalog must not inherit: `base: "/app/"`, a
// dev proxy to a backend no story talks to, and port 5180.
//
// Only what stories actually need is re-declared. The React plugin is
// deliberately absent — @storybook/react-vite supplies its own, and a second
// copy breaks fast refresh. `base` stays unset so the built catalog uses
// relative asset paths and can be served from any prefix.
export default defineConfig({
  plugins: [tailwindcss(), scoutAssetsPlugin({ emit: true })],
  build: { outDir: "storybook-static", emptyOutDir: false },
});
