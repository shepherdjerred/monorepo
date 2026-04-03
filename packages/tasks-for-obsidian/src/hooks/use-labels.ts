import { useMemo } from "react";

import type { ContextName, TagName } from "../domain/types";
import { isActiveStatus } from "../domain/status";
import { useTaskContext } from "../state/TaskContext";

type Labels = {
  contexts: ContextName[];
  tags: TagName[];
};

export function useLabels(): Labels {
  const { tasks } = useTaskContext();

  return useMemo(() => {
    const contextSet = new Set<ContextName>();
    const tagSet = new Set<TagName>();
    for (const task of tasks.values()) {
      if (isActiveStatus(task.status)) {
        for (const ctx of task.contexts) {
          contextSet.add(ctx);
        }
        for (const tag of task.tags) {
          tagSet.add(tag);
        }
      }
    }
    return {
      contexts: [...contextSet].sort(),
      tags: [...tagSet].sort(),
    };
  }, [tasks]);
}
