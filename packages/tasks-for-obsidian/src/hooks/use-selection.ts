import { useCallback, useState } from "react";
import type { TaskId } from "../domain/types";
import { feedbackSelection } from "../lib/feedback";

/** Multi-select mode state for task list screens (Apple Reminders pattern). */
export function useSelection() {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<TaskId>>(new Set());

  const enterSelection = useCallback(() => {
    feedbackSelection();
    setSelectionMode(true);
  }, []);

  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelected(new Set());
  }, []);

  const toggleSelected = useCallback((id: TaskId) => {
    feedbackSelection();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return {
    selectionMode,
    selected,
    enterSelection,
    exitSelection,
    toggleSelected,
  };
}
