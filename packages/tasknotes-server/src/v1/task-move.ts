import type { ValidatedSyncCommand } from "./schemas.ts";
import { resolveRequiredId } from "./sync-parsers.ts";
import { EntityNotFoundError, type FacetStore } from "./types.ts";

type Placement = { project: string; parent: string | undefined };

function checkParentChain(
  id: string,
  placements: Map<string, Placement>,
): void {
  const task = placements.get(id);
  const seen = new Set([id]);
  let parent = task?.parent;
  while (parent !== undefined) {
    const placement = placements.get(parent);
    if (
      placement === undefined ||
      placement.project !== task?.project ||
      seen.has(parent)
    ) {
      throw new TypeError(
        "The moved task and its parent must share a project and cannot form a cycle.",
      );
    }
    seen.add(parent);
    parent = placement.parent;
  }
}

function affectedTasksHaveValidParents(
  affected: Set<string>,
  placements: Map<string, Placement>,
): void {
  // An offline client may have missed a newly attached child.
  for (const [id, placement] of placements) {
    if (
      affected.has(id) ||
      (placement.parent !== undefined && affected.has(placement.parent))
    ) {
      checkParentChain(id, placements);
    }
  }
}

export async function moveTasks(
  store: FacetStore,
  userId: string,
  entries: Extract<ValidatedSyncCommand, { type: "TaskMove" }>["args"]["tasks"],
  mapping: Record<string, string>,
): Promise<void> {
  const resolve = (id: string) => resolveRequiredId(id, mapping);
  const tasks = await store.listTasks({ userId, includeDeleted: false });
  const placements = new Map(
    tasks.map((task) => [
      task.id,
      { project: task.project_id, parent: task.parent_id },
    ]),
  );
  const moves = entries.map((entry) => ({
    id: resolve(entry.id),
    project: resolve(entry.project_id),
    section:
      entry.section_id === undefined ? undefined : resolve(entry.section_id),
    parent:
      entry.parent_id === undefined ? undefined : resolve(entry.parent_id),
    order: entry.child_order,
  }));
  const affected = new Set<string>();
  for (const move of moves) {
    if (!placements.has(move.id))
      throw new EntityNotFoundError("Task", move.id);
    if (affected.has(move.id))
      throw new TypeError("A task can only move once per command.");
    affected.add(move.id);
    placements.set(move.id, move);
  }
  affectedTasksHaveValidParents(affected, placements);
  const sections = moves.some((move) => move.section !== undefined)
    ? await store.listSections({ userId, includeDeleted: false })
    : [];
  const sectionProjects = new Map(
    sections
      .filter((section) => !section.is_archived)
      .map((section) => [section.id, section.project_id]),
  );
  for (const move of moves) {
    if (
      move.section !== undefined &&
      sectionProjects.get(move.section) !== move.project
    ) {
      throw new TypeError(
        "The destination section must belong to the destination project.",
      );
    }
    const result = await store.updateTask(move.id, userId, {
      projectId: move.project,
      sectionId: move.section ?? null,
      parentId: move.parent ?? null,
      childOrder: move.order,
    });
    if (result === null) throw new EntityNotFoundError("Task", move.id);
  }
}
