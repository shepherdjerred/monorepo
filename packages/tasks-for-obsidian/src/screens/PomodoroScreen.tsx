import React, { useCallback } from "react";
import { View, Text, Pressable, FlatList, StyleSheet } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import type { Task, TaskId } from "../domain/types";
import { useTasks } from "../hooks/useTasks";
import { usePomodoro } from "../hooks/usePomodoro";
import { useSettings } from "../hooks/useSettings";
import { typography } from "../styles/typography";
import { PomodoroTimer } from "../components/timer/PomodoroTimer";

type Props = NativeStackScreenProps<RootStackParamList, "Pomodoro">;

export function PomodoroScreen({ route }: Props) {
  const initialTaskId = route.params?.taskId;
  const { colors } = useSettings();
  const { taskList } = useTasks();
  const { status, startPomodoro, stopPomodoro, pausePomodoro } = usePomodoro();

  const handleStart = useCallback(
    (id?: TaskId) => {
      if (id) void startPomodoro(id);
    },
    [startPomodoro],
  );

  const renderTaskItem = useCallback(
    ({ item }: { item: Task }) => (
      <Pressable
        style={[styles.taskItem, { borderBottomColor: colors.borderLight }]}
        onPress={() => handleStart(item.id)}
      >
        <Text style={[typography.body, { color: colors.text }]} numberOfLines={1}>
          {item.title}
        </Text>
      </Pressable>
    ),
    [colors, handleStart],
  );

  const timeRemaining = status?.timeRemaining ?? 25 * 60;
  const timerType = status?.type ?? "work";
  const isActive = status?.active ?? false;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <PomodoroTimer
        timeRemaining={timeRemaining}
        type={timerType}
        active={isActive}
      />

      <View style={styles.controls}>
        {isActive ? (
          <>
            <Pressable
              style={[styles.button, { backgroundColor: colors.warning }]}
              onPress={() => void pausePomodoro()}
            >
              <Text style={styles.buttonText}>Pause</Text>
            </Pressable>
            <Pressable
              style={[styles.button, { backgroundColor: colors.error }]}
              onPress={() => void stopPomodoro()}
            >
              <Text style={styles.buttonText}>Stop</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            style={[styles.button, { backgroundColor: colors.primary }]}
            onPress={() => { if (initialTaskId) handleStart(initialTaskId); }}
          >
            <Text style={styles.buttonText}>Start</Text>
          </Pressable>
        )}
      </View>

      {!isActive ? (
        <View style={styles.taskListContainer}>
          <Text style={[typography.label, { color: colors.textSecondary }, styles.taskListHeader]}>
            Select a task
          </Text>
          <FlatList
            data={taskList}
            keyExtractor={(item) => item.id}
            renderItem={renderTaskItem}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  controls: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 16,
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 8,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  taskListContainer: {
    flex: 1,
    marginTop: 24,
  },
  taskListHeader: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  taskItem: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
