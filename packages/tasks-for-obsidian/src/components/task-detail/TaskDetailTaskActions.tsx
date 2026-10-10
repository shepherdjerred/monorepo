import React from "react";
import { View } from "react-native";

import type { Task } from "../../domain/types";
import { useSettings } from "../../hooks/use-settings";
import { ActionRow, SectionTitle } from "./TaskDetailControls";
import { taskDetailCompletionAction } from "./task-detail-completion";
import { taskDetailStyles as styles } from "./task-detail-styles";

type Props = {
  readonly task: Task;
  readonly isWorking: boolean;
  readonly onToggleCompletion: () => void;
};

export function TaskDetailTaskActions({
  task,
  isWorking,
  onToggleCompletion,
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
      </View>
    </>
  );
}
