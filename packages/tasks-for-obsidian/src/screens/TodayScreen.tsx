import React, { useCallback } from "react";
import { View, StyleSheet } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { CompositeScreenProps } from "@react-navigation/native";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { TaskId } from "../domain/types";
import type { RootStackParamList, MainTabParamList } from "../navigation/types";
import { useTasks } from "../hooks/useTasks";
import { TaskList } from "../components/task/TaskList";
import { FAB } from "../components/common/FAB";

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, "Today">,
  NativeStackScreenProps<RootStackParamList>
>;

export function TodayScreen({ navigation }: Props) {
  const { todayTasks, toggleTask, refresh, refreshing } = useTasks();

  const handlePress = useCallback(
    (id: TaskId) => navigation.navigate("TaskDetail", { taskId: id }),
    [navigation],
  );

  const handleToggle = useCallback(
    (id: TaskId) => toggleTask(id),
    [toggleTask],
  );

  return (
    <View style={styles.container}>
      <TaskList
        tasks={todayTasks}
        onTaskPress={handlePress}
        onTaskToggle={handleToggle}
        onRefresh={refresh}
        refreshing={refreshing}
        emptyTitle="Nothing due today"
        emptySubtitle="Tasks due today and overdue tasks appear here"
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
