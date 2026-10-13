import { fileURLToPath } from "node:url";
import { previewStorybook } from "@scout-for-lol/design-system/storybook/preview-runtime";

process.exitCode = await previewStorybook({
  packageRoot: fileURLToPath(new URL("../", import.meta.url)),
  port: 5191,
  config: ".storybook/vite.config.ts",
  args: Bun.argv.slice(2),
});
