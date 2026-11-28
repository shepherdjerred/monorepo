/**
 * The Delivery stage bootstrap's prepared-outputs step (see
 * DELIVERY_JOB_BOOTSTRAP). `restore <key>` exits 0 only when it restored the
 * kept outputs; any other exit makes the bootstrap regenerate. `keep <key>`
 * never fails the Job for a reason it understands: the outputs are already
 * in place and keeping them only saves the next Job's writes.
 */
import { rm } from "node:fs/promises";
import {
  keepPreparedOutputs,
  restorePreparedOutputs,
  STAGE_WORKSPACE,
} from "#lib/delivery/prepared-outputs.ts";

const [action, key] = process.argv.slice(2);
if (key === undefined || !["restore", "keep"].includes(action ?? ""))
  throw new Error("usage: prepared-outputs.ts <restore|keep> <key>");

if (action === "restore") {
  const result = await restorePreparedOutputs(STAGE_WORKSPACE, key);
  if (!result.restored && result.reason === "changed")
    console.error(
      `Delivery stage workspace: kept prepared outputs no longer match their manifest (${result.detail}); regenerating`,
    );
  process.exit(result.restored ? 0 : 1);
}

try {
  const result = await keepPreparedOutputs(STAGE_WORKSPACE, key);
  if (!result.kept)
    console.error(
      `Delivery stage workspace: prepared outputs were not kept (${result.detail})`,
    );
} catch (error) {
  await rm(STAGE_WORKSPACE.prepared, { recursive: true, force: true });
  console.error(
    `Delivery stage workspace: prepared outputs were not kept (${String(error)})`,
  );
}
