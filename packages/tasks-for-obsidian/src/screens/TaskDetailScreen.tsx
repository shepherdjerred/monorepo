import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { usePreventRemove } from "@react-navigation/native";

import { TaskDetailEditor } from "../components/task-detail/TaskDetailEditor";
import {
  buildTaskDetailPatch,
  createTaskDetailDraft,
  rebaseTaskDetailDraft,
  taskDetailDraftIsDirty,
} from "../components/task-detail/task-detail-draft";
import type { TaskDetailDraft } from "../components/task-detail/task-detail-draft";
import {
  shouldDismissMissingTask,
  shouldPreventTaskDetailRemove,
  type TaskDetailDismissRequest,
} from "../components/task-detail/task-detail-dismissal";
import type { Task } from "../domain/types";
import { taskDetailCompletionAction } from "../components/task-detail/task-detail-completion";
import { useSettings } from "../hooks/use-settings";
import { useTasks } from "../hooks/use-tasks";
import {
  feedbackButtonPress,
  feedbackTaskComplete,
  feedbackTaskDelete,
  feedbackTaskUncomplete,
} from "../lib/feedback";
import { showResultError } from "../lib/errors";
import type { RootStackParamList } from "../navigation/types";
import { useTimeTrackingContext } from "../state/TimeTrackingContext";
import { UndoProvider } from "../state/UndoContext";
import { typography } from "../styles/typography";

type Props = NativeStackScreenProps<RootStackParamList, "TaskDetail">;
type DismissAction = Parameters<Props["navigation"]["dispatch"]>[0];

export function TaskDetailScreen({ route, navigation }: Props) {
  const { taskId } = route.params;
  const { colors } = useSettings();
  const { getTask } = useTasks();
  const task = getTask(taskId);
  const taskWasResolvedRef = useRef(task !== null);

  useEffect(() => {
    if (task !== null) {
      taskWasResolvedRef.current = true;
      return;
    }
    if (shouldDismissMissingTask(taskWasResolvedRef.current, false)) {
      navigation.goBack();
    }
  }, [navigation, task]);

  if (!task) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={[typography.body, { color: colors.textSecondary }]}>
          Task not found
        </Text>
      </View>
    );
  }

  // Native form-sheet screens live above the root React Navigation surface.
  // Scope the Undo host to this presentation so recurring-completion feedback
  // and its action render inside the sheet instead of behind its dimming view.
  return (
    <UndoProvider>
      <TaskDetailRoute task={task} navigation={navigation} />
    </UndoProvider>
  );
}

function TaskDetailRoute({
  task,
  navigation,
}: {
  readonly task: Task;
  readonly navigation: Props["navigation"];
}) {
  const { colors } = useSettings();
  const {
    updateTask,
    deleteTask,
    toggleTask,
    dayCounts,
    projectNames,
    contextNames,
    tagNames,
  } = useTasks();
  const { activeEntry, startTracking, stopTracking } = useTimeTrackingContext();
  const [draft, setDraft] = useState<TaskDetailDraft>(() =>
    createTaskDetailDraft(task),
  );
  const [draftBaseTask, setDraftBaseTask] = useState(task);
  const [isWorking, setIsWorking] = useState(false);
  const [dismissRequest, setDismissRequest] =
    useState<TaskDetailDismissRequest<DismissAction> | null>(null);
  const dismissalStartedRef = useRef(false);

  const rebasedDraft = useMemo(
    () => rebaseTaskDetailDraft(draftBaseTask, task, draft),
    [draft, draftBaseTask, task],
  );

  const patchResult = useMemo(
    () => buildTaskDetailPatch(task, rebasedDraft),
    [task, rebasedDraft],
  );
  const dirty = useMemo(
    () => taskDetailDraftIsDirty(task, rebasedDraft),
    [task, rebasedDraft],
  );
  const validationField = patchResult.ok ? null : patchResult.field;
  const validationMessage = patchResult.ok ? null : patchResult.message;
  const isTracking = activeEntry?.taskId === task.id;

  useEffect(() => {
    if (draftBaseTask === task) return;
    setDraft((current) => rebaseTaskDetailDraft(draftBaseTask, task, current));
    setDraftBaseTask(task);
  }, [draftBaseTask, task]);

  const dismissAfterCommit = useCallback(() => {
    setDismissRequest({ kind: "go-back" });
  }, []);

  const requestCancel = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleSave = useCallback(() => {
    if (!patchResult.ok) {
      Alert.alert("Can't Save", patchResult.message);
      return;
    }
    if (Object.keys(patchResult.patch).length === 0) {
      dismissAfterCommit();
      return;
    }

    feedbackButtonPress();
    setIsWorking(true);
    void (async () => {
      const result = await updateTask(task.id, patchResult.patch);
      if (showResultError(result, "Save Failed")) {
        setIsWorking(false);
        return;
      }
      dismissAfterCommit();
    })();
  }, [dismissAfterCommit, patchResult, task.id, updateTask]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: "Edit Task",
      headerLeft: () => (
        <HeaderButton
          label="Cancel"
          color={colors.primary}
          disabled={isWorking}
          onPress={requestCancel}
          testID="task-detail-cancel"
        />
      ),
      headerRight: () => (
        <HeaderButton
          label={isWorking ? "Saving…" : "Done"}
          color={colors.primary}
          emphasized
          disabled={isWorking || validationMessage !== null}
          onPress={handleSave}
          testID="task-detail-save"
        />
      ),
    });
  }, [
    colors.primary,
    handleSave,
    isWorking,
    navigation,
    requestCancel,
    validationMessage,
  ]);

  usePreventRemove(
    shouldPreventTaskDetailRemove(dirty, dismissRequest),
    ({ data }) => {
      Alert.alert("Discard Changes?", "Your edits haven't been saved.", [
        { text: "Keep Editing", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            setDismissRequest({ kind: "dispatch", action: data.action });
          },
        },
      ]);
    },
  );

  useEffect(() => {
    if (dismissRequest === null || dismissalStartedRef.current) return;
    dismissalStartedRef.current = true;
    if (dismissRequest.kind === "go-back") {
      navigation.goBack();
      return;
    }
    navigation.dispatch(dismissRequest.action);
  }, [dismissRequest, navigation]);

  const handleToggleCompletion = useCallback(() => {
    const completion = taskDetailCompletionAction(task);
    if (completion.completed) feedbackTaskUncomplete();
    else feedbackTaskComplete();

    setIsWorking(true);
    void (async () => {
      const result = await toggleTask(task.id, { scope: completion.scope });
      showResultError(
        result,
        completion.completed ? "Uncomplete Failed" : "Complete Failed",
      );
      setIsWorking(false);
    })();
  }, [task, toggleTask]);

  const handleToggleTracking = useCallback(() => {
    feedbackButtonPress();
    setIsWorking(true);
    void (async () => {
      const result = isTracking
        ? await stopTracking(task.id)
        : await startTracking(task.id);
      showResultError(
        result,
        isTracking ? "Stop Tracking Failed" : "Start Tracking Failed",
      );
      setIsWorking(false);
    })();
  }, [isTracking, startTracking, stopTracking, task.id]);

  const handleDelete = useCallback(() => {
    Alert.alert(
      "Delete Task?",
      `“${task.title}” will be permanently deleted.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            feedbackTaskDelete();
            setIsWorking(true);
            void (async () => {
              const result = await deleteTask(task.id);
              if (showResultError(result, "Delete Failed")) {
                setIsWorking(false);
                return;
              }
              dismissAfterCommit();
            })();
          },
        },
      ],
    );
  }, [deleteTask, dismissAfterCommit, task.id, task.title]);

  return (
    <TaskDetailEditor
      task={task}
      draft={rebasedDraft}
      dayCounts={dayCounts}
      availableProjects={projectNames}
      availableContexts={contextNames}
      availableTags={tagNames}
      validationField={validationField}
      validationMessage={validationMessage}
      isWorking={isWorking}
      isTracking={isTracking}
      onChange={setDraft}
      onToggleCompletion={handleToggleCompletion}
      onToggleTracking={handleToggleTracking}
      onDelete={handleDelete}
    />
  );
}

function HeaderButton({
  label,
  color,
  emphasized = false,
  disabled,
  onPress,
  testID,
}: {
  readonly label: string;
  readonly color: string;
  readonly emphasized?: boolean | undefined;
  readonly disabled: boolean;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  return (
    <Pressable
      style={({ pressed }) => ({
        opacity: disabled ? 0.35 : pressed ? 0.55 : 1,
      })}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
    >
      <Text
        style={[
          typography.body,
          { color, fontWeight: emphasized ? "600" : "400" },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
});
