import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
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
