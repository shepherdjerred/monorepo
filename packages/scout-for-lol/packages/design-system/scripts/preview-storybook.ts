import { fileURLToPath } from "node:url";
import { previewStorybook } from "#src/storybook/preview-runtime.ts";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
process.exitCode = await previewStorybook({
  packageRoot,
  port: 6006,
  args: Bun.argv.slice(2),
});
