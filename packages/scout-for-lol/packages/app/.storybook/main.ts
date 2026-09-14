import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.tsx"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y"],
  framework: {
    name: "@storybook/react-vite",
    options: { builder: { viteConfigPath: ".storybook/vite.config.ts" } },
  },
  core: { disableTelemetry: true },
  // Controls come from story args. react-docgen runs its own Babel pass, which
  // trails the TypeScript version this package compiles with.
  typescript: { reactDocgen: false },
  // Resolve the theme before first paint, exactly as index.html does for the
  // SPA. scoutAssetsPlugin serves this URL in dev and emits it on build.
  previewHead: (head) =>
    `${head ?? ""}<script src="/assets/scout/brand/theme-bootstrap.js"></script>`,
};

export default config;
