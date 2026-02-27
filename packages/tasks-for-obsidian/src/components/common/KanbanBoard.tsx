import React from "react";
import { ScrollView, StyleSheet } from "react-native";
import type { Task, TaskId } from "../../domain/types";
import type { KanbanMoveTarget } from "./KanbanCard";
import { KanbanColumn } from "./KanbanColumn";

export type KanbanColumnConfig = {
  readonly key: string;
  readonly title: string;
  readonly color: string;
  readonly tasks: readonly Task[];
};

type Props = {
  columns: readonly KanbanColumnConfig[];
  onTaskPress: (id: TaskId) => void;
  onTaskToggle?: ((id: TaskId) => void) | undefined;
  onTaskEdit?: ((id: TaskId) => void) | undefined;
  onTaskDelete?: ((id: TaskId) => void) | undefined;
  getMoveTargets?: ((id: TaskId) => readonly KanbanMoveTarget[]) | undefined;
  onTaskMoveTo?: ((id: TaskId, columnKey: string) => void) | undefined;
};

export function KanbanBoard({
  columns,
  onTaskPress,
  onTaskToggle,
  onTaskEdit,
  onTaskDelete,
  getMoveTargets,
  onTaskMoveTo,
}: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      {columns.map((col) => (
        <KanbanColumn
          key={col.key}
          title={col.title}
          color={col.color}
          tasks={col.tasks}
          onTaskPress={onTaskPress}
          onTaskToggle={onTaskToggle}
          onTaskEdit={onTaskEdit}
          onTaskDelete={onTaskDelete}
          getMoveTargets={getMoveTargets}
          onTaskMoveTo={onTaskMoveTo}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
    paddingRight: 24,
  },
});
