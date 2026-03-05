import React, { useEffect } from "react";
import { Pressable, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withSpring,
  withTiming,
  interpolateColor,
} from "react-native-reanimated";
import type { TaskStatus } from "../../domain/status";
import { isCompletedStatus } from "../../domain/status";
import type { Priority } from "../../domain/priority";
import { PRIORITY_COLORS } from "../../domain/priority";
import {
  feedbackTaskComplete,
  feedbackTaskUncomplete,
} from "../../lib/feedback";

type TaskCheckboxProps = {
  status: TaskStatus;
  priority: Priority;
  onToggle: () => void;
};

export const TaskCheckbox = React.memo(function TaskCheckbox({
  status,
  priority,
  onToggle,
}: TaskCheckboxProps) {
  const completed = isCompletedStatus(status);
  const borderColor = PRIORITY_COLORS[priority];

  const scale = useSharedValue(1);
  const fillProgress = useSharedValue(completed ? 1 : 0);

  useEffect(() => {
    fillProgress.value = completed ? 1 : 0;
  }, [completed, fillProgress]);

  const handleToggle = () => {
    if (completed) {
      feedbackTaskUncomplete();
      scale.value = withSequence(
        withTiming(0.9, { duration: 50 }),
        withSpring(1, { damping: 15, stiffness: 400 }),
      );
      fillProgress.value = withTiming(0, { duration: 60 });
    } else {
      feedbackTaskComplete();
      scale.value = withSequence(
        withSpring(1.2, { damping: 12, stiffness: 600 }),
        withSpring(1, { damping: 15, stiffness: 400 }),
      );
      fillProgress.value = withTiming(1, { duration: 80 });
    }
    onToggle();
  };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    backgroundColor: interpolateColor(
      fillProgress.value,
      [0, 1],
      ["transparent", borderColor],
    ),
  }));

  return (
    <Pressable
      onPress={handleToggle}
      hitSlop={11}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: completed }}
      accessibilityLabel={`${completed ? "Uncheck" : "Check"} task`}
    >
      <Animated.View style={[styles.circle, { borderColor }, animatedStyle]} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  circle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
  },
});
