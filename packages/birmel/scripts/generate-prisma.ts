import { mkdir, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const generate = Bun.spawn(["bunx", "--trust", "prisma", "generate"], {
  stdout: "inherit",
  stderr: "inherit",
});
const exitCode = await generate.exited;
if (exitCode !== 0) {
  throw new Error(`prisma generate exited with code ${String(exitCode)}`);
}

// Prisma's generated @prisma/client/default.js requires
// ".prisma/client/default" relative to @prisma/client. On the deployed Bun
// image, that package-local path was not resolving to node_modules/.prisma,
// so make the expected package-local link explicit after generation.
const clientDir = fileURLToPath(
  new URL("../node_modules/@prisma/client", import.meta.url),
);
const linkPath = `${clientDir}/.prisma`;
await mkdir(path.dirname(linkPath), { recursive: true });
await rm(linkPath, { recursive: true, force: true });
await symlink("../../.prisma", linkPath, "dir");
