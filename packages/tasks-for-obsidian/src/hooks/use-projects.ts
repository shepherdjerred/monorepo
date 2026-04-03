import { useMemo } from "react";

import type { ProjectName } from "../domain/types";
import { isActiveStatus } from "../domain/status";
import { useTaskContext } from "../state/TaskContext";

export function useProjects(): ProjectName[] {
  const { tasks } = useTaskContext();

  return useMemo(() => {
    const projectSet = new Set<ProjectName>();
    for (const task of tasks.values()) {
      if (isActiveStatus(task.status)) {
        for (const project of task.projects) {
          projectSet.add(project);
        }
      }
    }
    return [...projectSet].sort();
  }, [tasks]);
}
