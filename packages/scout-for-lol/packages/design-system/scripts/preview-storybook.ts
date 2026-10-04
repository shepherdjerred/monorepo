import { fileURLToPath } from "node:url";
import { resolvePreviewNodeExecutable } from "#src/storybook/preview-runtime.ts";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const nodeExecutable = await resolvePreviewNodeExecutable(packageRoot);
const server = Bun.spawn(
  [
    nodeExecutable,
    fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url)),
    "preview",
    "--outDir",
    "storybook-static",
    "--host",
    "127.0.0.1",
    "--port",
    "6006",
    "--strictPort",
    ...Bun.argv.slice(2),
  ],
  {
    cwd: packageRoot,
    env: Bun.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
);
process.exitCode = await server.exited;
