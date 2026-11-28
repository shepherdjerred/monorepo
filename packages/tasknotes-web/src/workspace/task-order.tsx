import type { Task } from "@shepherdjerred/facet-protocol";
import { reorderTasks, type CommandHandler } from "./workspace-commands.ts";

export function TaskOrderButtons({
  tasks,
  position,
  onCommand,
}: {
  tasks: readonly Task[];
  position: number;
  onCommand: CommandHandler;
}) {
  if (tasks.length < 2) return null;
  function move(to: number) {
    const entries = reorderTasks(tasks, position, to);
    if (entries.length > 0) {
      void onCommand(
        { type: "TaskMove", args: { tasks: entries } },
        { notice: "Updated task order" },
      );
    }
  }
  return (
    <div className="feature-chips">
      <button
        className="secondary"
        type="button"
        aria-label={`Move ${tasks[position]?.title ?? "task"} earlier`}
        disabled={position === 0}
        onClick={() => {
          move(position - 1);
        }}
      >
        Move earlier
      </button>
      <button
        className="secondary"
        type="button"
        aria-label={`Move ${tasks[position]?.title ?? "task"} later`}
        disabled={position === tasks.length - 1}
        onClick={() => {
          move(position + 1);
        }}
      >
        Move later
      </button>
    </div>
  );
}
