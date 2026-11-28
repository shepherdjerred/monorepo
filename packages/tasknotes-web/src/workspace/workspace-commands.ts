import type {
  SyncCommand,
  Task,
  TaskMoveEntry,
} from "@shepherdjerred/facet-protocol";
import { sortTasks } from "./workspace.ts";

export type CommandHandler = (
  command: SyncCommand,
  options?: { tempId?: string; notice?: string },
) => Promise<boolean>;

export function taskMoveEntry(placement: TaskMoveEntry): TaskMoveEntry {
  const { section_id: sectionId, parent_id: parentId, ...required } = placement;
  return {
    ...required,
    ...(sectionId === undefined || sectionId === ""
      ? {}
      : { section_id: sectionId }),
    ...(parentId === undefined || parentId === ""
      ? {}
      : { parent_id: parentId }),
  };
}

export function reorderTasks(
  tasks: readonly Task[],
  from: number,
  to: number,
): TaskMoveEntry[] {
  const ordered = [...tasks];
  if (from === to || from < 0 || to < 0 || to >= ordered.length) return [];
  const [moving] = ordered.splice(from, 1);
  if (moving === undefined) return [];
  ordered.splice(to, 0, moving);
  return ordered.map((task, order) =>
    taskMoveEntry({
      id: task.id,
      project_id: task.project_id,
      section_id: task.section_id ?? "",
      parent_id: task.parent_id ?? "",
      child_order: order,
    }),
  );
}

export function moveTaskTrees(
  tasks: readonly Task[],
  roots: readonly string[],
  projectId: string,
  sectionId: string,
): TaskMoveEntry[] {
  const live = tasks.filter((task) => !task.is_deleted);
  const children = new Map<string, string[]>();
  for (const task of live) {
    if (task.parent_id === undefined || task.parent_id === "") continue;
    const siblings = children.get(task.parent_id) ?? [];
    siblings.push(task.id);
    children.set(task.parent_id, siblings);
  }
  const moving = new Set<string>();
  const pending = [...roots];
  for (const id of pending) {
    if (moving.has(id)) continue;
    moving.add(id);
    pending.push(...(children.get(id) ?? []));
  }
  const remaining = live.filter(
    (task) => task.project_id === projectId && !moving.has(task.id),
  );
  const retainedIds = new Set(remaining.map((task) => task.id));
  let order =
    remaining.reduce((max, task) => Math.max(max, task.child_order), -1) + 1;
  return live
    .filter((task) => moving.has(task.id))
    .sort(sortTasks)
    .map((task) => {
      const parent = task.parent_id ?? "";
      const parentId =
        moving.has(parent) || retainedIds.has(parent) ? parent : "";
      return taskMoveEntry({
        id: task.id,
        project_id: projectId,
        section_id: sectionId,
        parent_id: parentId,
        child_order: order++,
      });
    });
}
