import React, { useCallback } from "react";
import { View, StyleSheet } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { CompositeScreenProps } from "@react-navigation/native";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { TaskId } from "../domain/types";
import type { RootStackParamList, MainTabParamList } from "../navigation/types";
import { useTasks } from "../hooks/useTasks";
import { getDateGroup } from "../lib/dates";
import { TaskList } from "../components/task/TaskList";
import { FAB } from "../components/common/FAB";

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, "Upcoming">,
  NativeStackScreenProps<RootStackParamList>
>;

export function UpcomingScreen({ navigation }: Props) {
  const { upcomingTasks, toggleTask, refresh, refreshing } = useTasks();

  const handlePress = useCallback(
    (id: TaskId) => navigation.navigate("TaskDetail", { taskId: id }),
    [navigation],
  );

  const handleToggle = useCallback(
    (id: TaskId) => toggleTask(id),
    [toggleTask],
  );

  const sectionBy = useCallback(
    (task: { due?: string | undefined }) => (task.due ? getDateGroup(task.due) : "No Date"),
    [],
  );

  return (
    <View style={styles.container}>
      <TaskList
        tasks={upcomingTasks}
        onTaskPress={handlePress}
        onTaskToggle={handleToggle}
        onRefresh={refresh}
        refreshing={refreshing}
        emptyTitle="No upcoming tasks"
        emptySubtitle="Tasks with future due dates appear here"
        sectionBy={sectionBy}
      />
      <FAB onPress={() => navigation.navigate("QuickAdd")} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
