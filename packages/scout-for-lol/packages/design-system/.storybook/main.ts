import type { StorybookConfig } from "@storybook/react-vite";
import { env } from "node:process";

// The deployed site serves the app's catalog alongside this one, under /app/.
// Composition is opt-in because a local `bun run dev` has no /app to reach, and
// an unreachable ref surfaces as a broken entry in the sidebar.
const composedRefs =
  env["SCOUT_STORYBOOK_COMPOSED"] === "true"
    ? { refs: { app: { title: "Scout app", url: "/app" } } }
    : {};

const config: StorybookConfig = {
  ...composedRefs,
  stories: ["../src/**/*.stories.tsx"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y"],
  framework: { name: "@storybook/react-vite", options: {} },
  core: { disableTelemetry: true },
  // Controls are declared through story args. react-docgen parses component
  // sources with its own Babel pass, which trails the TypeScript version this
  // package compiles with.
  typescript: { reactDocgen: false },
  // The Scout theme must resolve before first paint, exactly as the deleted
  // index.html arranged it. scoutAssetsPlugin serves this URL from
  // SCOUT_THEME_BOOTSTRAP_SCRIPT in dev and emits the file on build.
  previewHead: (head) =>
    `${head ?? ""}<script src="/assets/scout/brand/theme-bootstrap.js"></script>`,
};

export default config;
