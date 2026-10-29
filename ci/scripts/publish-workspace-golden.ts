import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  GOLDEN_MARKER,
  GOLDEN_ROOT,
  GoldenMarkerSchema,
  WORKSPACE_ROOT,
} from "../../packages/woodpecker-config-extension/src/checkout/golden.ts";
import { git } from "../../packages/woodpecker-config-extension/src/checkout/git.ts";
import { cloneTree } from "../../packages/woodpecker-config-extension/src/checkout/snapshot.ts";

// Copies this freshly installed main checkout into the golden claim at the
// same path a workflow workspace uses, so a claim cloned from its snapshot is
// a ready workspace. Temporal snapshots the claim after this step succeeds.
const workspace = process.cwd();
const relative = path.relative(WORKSPACE_ROOT, workspace);
if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative))
  throw new Error(`Workspace ${workspace} is not under ${WORKSPACE_ROOT}`);
const commit = await git(workspace, ["rev-parse", "HEAD"]);
// Only installed dependencies and their generated files may differ from the
// commit; a modified tracked file would ship to every workspace.
if (
  (await git(workspace, ["status", "--porcelain", "--untracked-files=no"])) !==
  ""
)
  throw new Error("Golden workspace source has modified tracked files");
const marker = GoldenMarkerSchema.parse({ version: 1, commit });
const target = path.join(GOLDEN_ROOT, relative);
await rm(target, { recursive: true, force: true });
await mkdir(path.dirname(target), { recursive: true });
await cloneTree(workspace, target);
await Bun.write(path.join(target, GOLDEN_MARKER), JSON.stringify(marker));
console.log(`CI_WORKSPACE_GOLDEN ${JSON.stringify(marker)}`);
console.log(`CI_MAINTENANCE_RESULT ${JSON.stringify({ status: "completed" })}`);
