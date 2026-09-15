import { defineConfig } from "vite";
import { scoutAssetsPlugin } from "./src/build/index.ts";

export default defineConfig({
  // Storybook's Vite builder loads this config, so the asset plugin is
  // registered exactly once here: its middleware serves /assets/scout/** and
  // the theme bootstrap during `storybook dev`, and closeBundle copies both
  // into storybook-static on build. The React plugin is deliberately absent —
  // @storybook/react-vite supplies its own.
  plugins: [scoutAssetsPlugin({ emit: true })],
  // Only `vite preview` reads this; Storybook sets its own output directory.
  build: { outDir: "storybook-static", emptyOutDir: false },
});
