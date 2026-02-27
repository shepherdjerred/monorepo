import React from "react";
import { View, Text, FlatList, StyleSheet } from "react-native";
import { useSettings } from "../../hooks/use-settings";
import type { Task, TaskId } from "../../domain/types";
import { KanbanCard, type KanbanMoveTarget } from "./KanbanCard";

type Props = {
  title: string;
  color: string;
  tasks: readonly Task[];
  onTaskPress: (id: TaskId) => void;
  onTaskToggle?: ((id: TaskId) => void) | undefined;
  onTaskEdit?: ((id: TaskId) => void) | undefined;
  onTaskDelete?: ((id: TaskId) => void) | undefined;
  getMoveTargets?: ((id: TaskId) => readonly KanbanMoveTarget[]) | undefined;
  onTaskMoveTo?: ((id: TaskId, columnKey: string) => void) | undefined;
};

export function KanbanColumn({
  title,
  color,
  tasks,
  onTaskPress,
  onTaskToggle,
  onTaskEdit,
  onTaskDelete,
  getMoveTargets,
  onTaskMoveTo,
}: Props) {
  const { colors } = useSettings();

  return (
    <View style={[styles.column, { backgroundColor: colors.surface }]}>
      <View style={[styles.header, { borderBottomColor: color }]}>
        <Text style={[styles.title, { color }]}>{title}</Text>
        <View style={[styles.countBadge, { backgroundColor: color + "1A" }]}>
          <Text style={[styles.countText, { color }]}>{tasks.length}</Text>
        </View>
      </View>
      <FlatList
        data={tasks}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <KanbanCard
            task={item}
            onPress={() => { onTaskPress(item.id); }}
            onToggle={onTaskToggle ? () => { onTaskToggle(item.id); } : undefined}
            onEdit={onTaskEdit ? () => { onTaskEdit(item.id); } : undefined}
            onDelete={onTaskDelete ? () => { onTaskDelete(item.id); } : undefined}
            moveTargets={getMoveTargets ? getMoveTargets(item.id) : undefined}
            onMoveTo={onTaskMoveTo ? (columnKey) => { onTaskMoveTo(item.id, columnKey); } : undefined}
          />
        )}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    width: 260,
    borderRadius: 12,
    overflow: "hidden",
    marginRight: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
    borderBottomWidth: 3,
  },
  title: {
    fontSize: 14,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  countBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  countText: {
    fontSize: 12,
    fontWeight: "600",
  },
  list: {
    padding: 8,
  },
});
