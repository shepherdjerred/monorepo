import type { SyncCommand, Task } from "@shepherdjerred/facet-protocol";
import completionSound from "@shepherdjerred/facet-protocol/presentation/audio/complete.wav?url";
import { useState } from "react";
import { reportAction } from "./ui-action.ts";
import { inverseFor, type UndoAction } from "./undo.ts";
import { workspaceEngine } from "#sync/workspace-engine.ts";

export function useWorkspaceMutations(tasks: readonly Task[], sound: boolean) {
  const [undo, setUndo] = useState<UndoAction | null>(null);

  async function onCommand(
    command: SyncCommand,
    options?: { tempId?: string },
  ): Promise<boolean> {
    const inverse = inverseFor(command, tasks);
    try {
      await workspaceEngine.enqueue(command, options);
    } catch {
      return false;
    }
    if (inverse !== null) setUndo(inverse);
    if (sound && command.type === "TaskComplete") {
      void reportAction(() => new Audio(completionSound).play());
    }
    return true;
  }

  async function performUndo(): Promise<void> {
    if (undo === null) return;
    await reportAction(async () => {
      await workspaceEngine.enqueueBatch(
        undo.commands.map((command) => ({ command })),
      );
      setUndo(null);
    });
  }

  function toggle(task: Task): void {
    void onCommand(
      task.completed
        ? { type: "TaskUncomplete", args: { id: task.id } }
        : {
            type: "TaskComplete",
            args: { id: task.id, completed_at: new Date().toISOString() },
          },
    );
  }

  return { onCommand, toggle, undo, performUndo };
}
