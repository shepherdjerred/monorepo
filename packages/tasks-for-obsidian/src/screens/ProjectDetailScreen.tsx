import React, { useCallback, useMemo } from "react";
import { View, StyleSheet } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { TaskId } from "../domain/types";
import type { RootStackParamList } from "../navigation/types";
import { useTasks } from "../hooks/useTasks";
import { TaskList } from "../components/task/TaskList";

type Props = NativeStackScreenProps<RootStackParamList, "ProjectDetail">;

export function ProjectDetailScreen({ route, navigation }: Props) {
  const { projectName } = route.params;
  const { taskList, toggleTask } = useTasks();

  const projectTasks = useMemo(
    () => taskList.filter((t) => t.projects.includes(projectName)),
    [taskList, projectName],
  );

  const handlePress = useCallback(
    (id: TaskId) => navigation.navigate("TaskDetail", { taskId: id }),
    [navigation],
  );

  const handleToggle = useCallback(
    (id: TaskId) => toggleTask(id),
    [toggleTask],
  );

  React.useEffect(() => {
    navigation.setOptions({ title: String(projectName) });
  }, [navigation, projectName]);

  return (
    <View style={styles.container}>
      <TaskList
        tasks={projectTasks}
        onTaskPress={handlePress}
        onTaskToggle={handleToggle}
        emptyTitle="No tasks in this project"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
