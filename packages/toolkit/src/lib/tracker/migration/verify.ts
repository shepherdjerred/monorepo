import { hash } from "./files.ts";
import { loadExport } from "./runner.ts";
import { exportLinear } from "./source.ts";
import type { LinearExport } from "./schema.ts";

const collections = [
  "teams",
  "states",
  "labels",
  "projects",
  "users",
  "issues",
  "comments",
  "relations",
  "attachments",
] as const;
export function snapshotChanges(before: LinearExport, after: LinearExport) {
  if (
    before.workspace.id !== after.workspace.id ||
    before.sharedUserId !== after.sharedUserId
  )
    throw new Error("Linear workspace or credential identity changed");
  const changes: Record<
    string,
    { added: number; removed: number; changed: number }
  > = {};
  for (const name of collections) {
    const previous = new Map(
      before[name].map((item) => [item.id, hash(JSON.stringify(item))]),
    );
    const current = new Map(
      after[name].map((item) => [item.id, hash(JSON.stringify(item))]),
    );
    if (
      previous.size !== before[name].length ||
      current.size !== after[name].length
    )
      throw new Error("Duplicate source identity in " + name);
    const added = [...current.keys()].filter((id) => !previous.has(id)).length;
    const removed = [...previous.keys()].filter(
      (id) => !current.has(id),
    ).length;
    const changed = [...current].filter(
      ([id, value]) => previous.has(id) && previous.get(id) !== value,
    ).length;
    if (added + removed + changed > 0)
      changes[name] = { added, removed, changed };
  }
  return changes;
}

export async function verifyFrozenExport(directory: string) {
  const snapshot = await loadExport(directory);
  const changes = snapshotChanges(snapshot, await exportLinear());
  if (Object.keys(changes).length > 0)
    throw new Error(
      "Linear changed since the frozen export: " + JSON.stringify(changes),
    );
  return { unchanged: true, exportedAt: snapshot.exportedAt };
}
