import React, { useCallback, useMemo } from "react";
import { View, StyleSheet } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { Task, TaskId } from "../domain/types";
import type { RootStackParamList } from "../navigation/types";
import type { KanbanMoveTarget } from "../components/common/KanbanCard";
import { isActiveStatus } from "../domain/status";
import { applyFilter } from "../domain/filters";
import { useTasks } from "../hooks/use-tasks";
import { showResultError } from "../lib/errors";
import {
  KanbanBoard,
  type KanbanColumnConfig,
} from "../components/common/KanbanBoard";

type Props = NativeStackScreenProps<RootStackParamList, "JobSearchKanban">;

const COLUMN_DEFS = [
  { key: "identified", title: "Identified", color: "#6366f1" },
  { key: "applied", title: "Applied", color: "#f59e0b" },
  { key: "screener", title: "Screener", color: "#22c55e" },
] as const;

const TAG_COLUMN_MAP: Record<string, string> = {
  identified: "identified",
  applied: "applied",
  screener: "screener",
};

function getColumnKey(task: {
  extraFields?: Readonly<Record<string, unknown>> | undefined;
  tags: readonly string[];
}): string {
  // First try extraFields.company_status
  const raw = task.extraFields?.["company_status"];
  const status = typeof raw === "string" ? raw.toLowerCase() : undefined;
  if (status && COLUMN_DEFS.some((c) => c.key === status)) return status;

  // Fall back to tag-based grouping
  for (const tag of task.tags) {
    const mapped = TAG_COLUMN_MAP[tag.toLowerCase()];
    if (mapped) return mapped;
  }

  return "identified"; // default column
}

export function JobSearchKanbanScreen({ navigation }: Props) {
  const { taskList, toggleTask, updateTask } = useTasks();

  const jobTasks = useMemo(
    () =>
      applyFilter(
        taskList.filter((t) => isActiveStatus(t.status)),
        { projects: ["[[2026 Job Search]]"] },
      ),
    [taskList],
  );

  const columns: KanbanColumnConfig[] = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    for (const def of COLUMN_DEFS) {
      grouped.set(def.key, []);
    }
    for (const task of jobTasks) {
      const key = getColumnKey(task);
      const defaultKey = COLUMN_DEFS[0].key;
      const bucket = grouped.get(key) ?? grouped.get(defaultKey) ?? [];
      bucket.push(task);
    }
    return COLUMN_DEFS.map((def) => ({
      ...def,
      tasks: grouped.get(def.key) ?? [],
    }));
  }, [jobTasks]);

  const handleTaskPress = useCallback(
    (id: TaskId) => {
      navigation.navigate("TaskDetail", { taskId: id });
    },
    [navigation],
  );

  const handleTaskToggle = useCallback(
    (id: TaskId) => {
      void (async () => {
        const r = await toggleTask(id);
        showResultError(r, "Toggle Failed");
      })();
    },
    [toggleTask],
  );

  const getMoveTargets = useCallback(
    (id: TaskId): readonly KanbanMoveTarget[] => {
      const task = jobTasks.find((t) => t.id === id);
      if (!task) return [];
      const currentColumn = getColumnKey(task);
      return COLUMN_DEFS.filter((c) => c.key !== currentColumn).map((c) => ({
        key: c.key,
        title: c.title,
      }));
    },
    [jobTasks],
  );

  const handleMoveTo = useCallback(
    (id: TaskId, columnKey: string) => {
      const task = jobTasks.find((t) => t.id === id);
      if (!task) return;

      void (async () => {
        const currentTags = task.tags.map(String);
        const cleanedTags = currentTags.filter(
          (t) => !Object.keys(TAG_COLUMN_MAP).includes(t.toLowerCase()),
        );
        cleanedTags.push(columnKey);
        const r = await updateTask(id, { tags: cleanedTags });
        showResultError(r, "Move Failed");
      })();
    },
    [jobTasks, updateTask],
  );

  return (
    <View style={styles.container}>
      <KanbanBoard
        columns={columns}
        onTaskPress={handleTaskPress}
        onTaskToggle={handleTaskToggle}
        getMoveTargets={getMoveTargets}
        onTaskMoveTo={handleMoveTo}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
