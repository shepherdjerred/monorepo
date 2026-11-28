import type { SyncCommand, Task } from "@shepherdjerred/facet-protocol";
import { taskMoveEntry } from "#workspace/workspace-commands.ts";

export type UndoAction = { label: string; commands: SyncCommand[] };

function restoredSchedule(task: Task) {
  return {
    id: task.id,
    due_date: task.due_date?.slice(0, 10) ?? "",
    due_datetime: task.due_datetime ?? "",
    due_timezone: task.due_timezone ?? "",
    due_string: task.due_string ?? "",
  };
}

function undoCompletion(task: Task): UndoAction {
  const commands: SyncCommand[] = [
    { type: "TaskUncomplete", args: { id: task.id } },
  ];
  if (task.is_recurring) {
    commands.push({
      type: "TaskUpdate",
      args: {
        ...restoredSchedule(task),
        recurrence_rule: task.recurrence_rule ?? "",
      },
    });
  }
  return { label: "Task completed", commands };
}

export function inverseFor(
  command: SyncCommand,
  tasks: readonly Task[],
): UndoAction | null {
  if (
    command.type !== "TaskComplete" &&
    command.type !== "TaskDelete" &&
    command.type !== "TaskMove" &&
    command.type !== "TaskReschedule"
  )
    return null;
  switch (command.type) {
    case "TaskComplete": {
      const task = tasks.find((item) => item.id === command.args.id);
      return task === undefined || task.completed ? null : undoCompletion(task);
    }
    case "TaskDelete": {
      const task = tasks.find((item) => item.id === command.args.id);
      if (task === undefined || task.is_deleted) return null;
      const restore = (item: Task): SyncCommand => ({
        type: "TaskUpdate",
        args: { id: item.id, restore_deleted: true },
      });
      const descendants = [task];
      for (const parent of descendants) {
        descendants.push(
          ...tasks.filter(
            (item) =>
              !item.is_deleted &&
              item.parent_id === parent.id &&
              !descendants.includes(item),
          ),
        );
      }
      return {
        label: "Task deleted",
        commands: descendants.map((item) => restore(item)),
      };
    }
    case "TaskMove": {
      const moved = new Set(command.args.tasks.map((task) => task.id));
      const entries = tasks
        .filter((task) => moved.has(task.id))
        .map((task) =>
          taskMoveEntry({
            id: task.id,
            project_id: task.project_id,
            section_id: task.section_id ?? "",
            parent_id: task.parent_id ?? "",
            child_order: task.child_order,
          }),
        );
      return entries.length === 0
        ? null
        : {
            label: "Tasks moved",
            commands: [{ type: "TaskMove", args: { tasks: entries } }],
          };
    }
    case "TaskReschedule": {
      const rescheduled = new Set(command.args.tasks.map((task) => task.id));
      const entries = tasks
        .filter((task) => rescheduled.has(task.id))
        .map((task) => restoredSchedule(task));
      return entries.length === 0
        ? null
        : {
            label: "Tasks rescheduled",
            commands: [{ type: "TaskReschedule", args: { tasks: entries } }],
          };
    }
  }
}
