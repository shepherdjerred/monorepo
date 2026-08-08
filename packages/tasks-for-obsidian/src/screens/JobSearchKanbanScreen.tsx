import React, { useCallback, useEffect, useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { Task, TaskId } from "../domain/types";
import type { RootStackParamList } from "../navigation/types";
import type { KanbanMoveTarget } from "../components/common/KanbanCard";
import { EmptyState } from "../components/common/EmptyState";
import {
  deriveJobSearchBoardSource,
  jobSearchColumnKey,
  jobSearchMovePatch,
} from "../domain/job-search-board";
import { localTodayYmd } from "../domain/recurrence";
import { useSavedViews } from "../hooks/use-saved-views";
import { useSettings } from "../hooks/use-settings";
import { useTasks } from "../hooks/use-tasks";
import { showResultError } from "../lib/errors";
import { parseLocalDate } from "../lib/dates";
import { typography } from "../styles/typography";
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

const EMPTY_TASKS: readonly Task[] = [];

export function JobSearchKanbanScreen({ navigation }: Props) {
  const { colors } = useSettings();
  const { taskList, pendingTaskIds, toggleTask, updateTask } = useTasks();
  const { preferences, views, error, isLoading, reload } = useSavedViews();
  const referenceDay = localTodayYmd();
  const referenceDate = useMemo(
    () => parseLocalDate(referenceDay),
    [referenceDay],
  );

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const source = useMemo(
    () => deriveJobSearchBoardSource(taskList, views, referenceDay),
    [referenceDay, taskList, views],
  );
  const jobTasks = source?.tasks ?? EMPTY_TASKS;

  useEffect(() => {
    if (source === null) return;
    navigation.setOptions({ title: `${source.view.name} Board` });
  }, [navigation, source]);

  const columns: KanbanColumnConfig[] = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    for (const def of COLUMN_DEFS) {
      grouped.set(def.key, []);
    }
    for (const task of jobTasks) {
      const key = jobSearchColumnKey(task);
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
      const currentColumn = jobSearchColumnKey(task);
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
        const r = await updateTask(id, jobSearchMovePatch(task, columnKey));
        showResultError(r, "Move Failed");
      })();
    },
    [jobTasks, updateTask],
  );

  if (isLoading && preferences === null) {
    return (
      <View
        style={[styles.centered, { backgroundColor: colors.background }]}
        accessibilityLabel="Loading Job Search board"
      >
        <ActivityIndicator color={colors.primary} />
        <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>
          Loading board…
        </Text>
      </View>
    );
  }

  if (error !== null && preferences === null) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <EmptyState
          title="The Job Search board could not load"
          subtitle={error.message}
          icon="alert-circle"
        />
        <Pressable
          style={[styles.retryButton, { borderTopColor: colors.divider }]}
          onPress={() => {
            void reload();
          }}
          accessibilityRole="button"
        >
          <Text style={[typography.label, { color: colors.primary }]}>
            Try Again
          </Text>
        </Pressable>
      </View>
    );
  }

  if (source === null) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <EmptyState
          title="Job Search board unavailable"
          subtitle="The saved view that powers this board was deleted."
          icon="columns"
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {error === null ? null : (
        <Text
          style={[
            styles.refreshError,
            typography.caption,
            { color: colors.error, borderBottomColor: colors.divider },
          ]}
          accessibilityRole="alert"
        >
          The saved view could not refresh: {error.message}
        </Text>
      )}
      <KanbanBoard
        columns={columns}
        referenceDate={referenceDate}
        pendingTaskIds={pendingTaskIds}
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
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  retryButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  refreshError: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
