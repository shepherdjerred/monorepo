import { $ } from "bun";
import { filesEqual } from "./migration-core.ts";

if (import.meta.main) {
  const root = Bun.env["CLAUDE_PROJECT_DIR"];
  if (root === undefined) throw new Error("CLAUDE_PROJECT_DIR is required");
  await $`bun install`.cwd(root);
  const schema = `${root}/packages/backend/prisma/schema.prisma`;
  const generated = `${root}/packages/backend/generated/prisma/client/schema.prisma`;
  if (!(await filesEqual(schema, generated)))
    await $`bun run generate`.cwd(root);
}
