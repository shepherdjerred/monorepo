import React from "react";
import { View } from "react-native";

import type { Task } from "../../domain/types";
import { useSettings } from "../../hooks/use-settings";
import { ActionRow, Divider, SectionTitle } from "./TaskDetailControls";
import { formatTaskMinutes } from "./task-detail-draft";
import { taskDetailCompletionAction } from "./task-detail-completion";
import { taskDetailStyles as styles } from "./task-detail-styles";

type Props = {
  readonly task: Task;
  readonly isTracking: boolean;
  readonly isWorking: boolean;
  readonly onToggleCompletion: () => void;
  readonly onToggleTracking: () => void;
};

export function TaskDetailTaskActions({
  task,
  isTracking,
  isWorking,
  onToggleCompletion,
  onToggleTracking,
}: Props) {
  const { colors } = useSettings();
  const completion = taskDetailCompletionAction(task);

  return (
    <>
      <SectionTitle>Task</SectionTitle>
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <ActionRow
          icon={completion.completed ? "check-circle" : "circle"}
          label={completion.label}
          value={completion.value}
          tint={completion.completed ? colors.textSecondary : colors.primary}
          disabled={isWorking}
          onPress={onToggleCompletion}
          testID="task-detail-toggle"
        />
        <Divider color={colors.borderLight} />
        <ActionRow
          icon={isTracking ? "pause-circle" : "play-circle"}
          label={isTracking ? "Stop Tracking" : "Start Tracking"}
          value={`${formatTaskMinutes(task.totalTrackedTime)} tracked`}
          tint={isTracking ? colors.error : colors.primary}
          disabled={isWorking}
          onPress={onToggleTracking}
          testID="task-detail-time-toggle"
        />
      </View>
    </>
  );
}
