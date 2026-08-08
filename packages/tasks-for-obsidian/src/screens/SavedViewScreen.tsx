import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { MenuView } from "@react-native-menu/menu";
import type { MenuAction } from "@react-native-menu/menu";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { AppIcon } from "../components/common/AppIcon";
import { EmptyState } from "../components/common/EmptyState";
import { FilterSortBar } from "../components/input/FilterSortBar";
import { SavedViewEditorModal } from "../components/saved-view/SavedViewEditorModal";
import { TaskList } from "../components/task/TaskList";
import {
  deriveSavedViewTasks,
  savedViewGroupLabel,
} from "../domain/saved-view-collection";
import type { SavedViewDefinition } from "../domain/saved-view-actions";
import type { SavedView } from "../domain/saved-views";
import { EMPTY_FILTER, applyFilter, applySort } from "../domain/filters";
import type { FilterConfig, SortConfig } from "../domain/filters";
import { localTodayYmd } from "../domain/recurrence";
import type { Task } from "../domain/types";
import { useSavedViews } from "../hooks/use-saved-views";
import { useSettings } from "../hooks/use-settings";
import { useTaskListScreen } from "../hooks/use-task-list-screen";
import type { RootStackParamList } from "../navigation/types";
import { typography } from "../styles/typography";

type Props = NativeStackScreenProps<RootStackParamList, "SavedView">;

function actionImage(image: string): Pick<MenuAction, "image"> {
  return Platform.OS === "ios" ? { image } : {};
}

function visibleSort(view: SavedView): SortConfig {
  switch (view.presentation.sort.field) {
    case "deadline":
      return {
        field: "dueDate",
        direction:
          view.presentation.sort.direction === "ascending" ? "asc" : "desc",
      };
    case "priority":
      return {
        field: "priority",
        direction:
          view.presentation.sort.direction === "ascending" ? "asc" : "desc",
      };
    case "title":
      return {
        field: "title",
        direction:
          view.presentation.sort.direction === "ascending" ? "asc" : "desc",
      };
    case "scheduled":
      return {
        field: "scheduled",
        direction:
          view.presentation.sort.direction === "ascending" ? "asc" : "desc",
      };
    case "created":
      return {
        field: "created",
        direction:
          view.presentation.sort.direction === "ascending" ? "asc" : "desc",
      };
    case "completed":
      return {
        field: "completed",
        direction:
          view.presentation.sort.direction === "ascending" ? "asc" : "desc",
      };
  }
}

type HeaderMenuProps = {
  readonly view: SavedView;
  readonly disabled: boolean;
  readonly color: string;
  readonly onEdit: () => void;
  readonly onDuplicate: () => void;
  readonly onDelete: () => void;
};

function SavedViewHeaderMenu({
  view,
  disabled,
  color,
  onEdit,
  onDuplicate,
  onDelete,
}: HeaderMenuProps) {
  const actions: MenuAction[] = [
    {
      id: "edit",
      title: "Edit View",
      attributes: { disabled },
      ...actionImage("pencil"),
    },
    {
      id: "duplicate",
      title: "Duplicate",
      attributes: { disabled },
      ...actionImage("plus.square.on.square"),
    },
    {
      id: "delete",
      title: "Delete View",
      attributes: { disabled, destructive: true },
      ...actionImage("trash"),
    },
  ];

  return (
    <MenuView
      title={view.name}
      actions={actions}
      onPressAction={({ nativeEvent }) => {
        switch (nativeEvent.event) {
          case "edit":
            onEdit();
            return;
          case "duplicate":
            onDuplicate();
            return;
          case "delete":
            onDelete();
            return;
        }
      }}
    >
      <View
        style={styles.headerMenu}
        accessibilityRole="button"
        accessibilityLabel={`More actions for ${view.name}`}
      >
        <AppIcon name="more-horizontal" size={22} color={color} />
      </View>
    </MenuView>
  );
}

export function SavedViewScreen({ route, navigation }: Props) {
  const { viewId } = route.params;
  const { colors } = useSettings();
  const tasks = useTaskListScreen(navigation);
  const {
    preferences,
    views,
    error,
    isLoading,
    isSaving,
    reload,
    editView,
    copyView,
    removeView,
  } = useSavedViews();
  const [filter, setFilter] = useState<FilterConfig>(EMPTY_FILTER);
  const [sortOverride, setSortOverride] = useState<SortConfig | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const view = views.find((candidate) => candidate.id === viewId);

  useEffect(() => {
    setFilter(EMPTY_FILTER);
    setSortOverride(null);
  }, [viewId]);

  const baseTasks = useMemo(
    () =>
      view === undefined
        ? []
        : deriveSavedViewTasks(tasks.taskList, view, localTodayYmd()),
    [tasks.taskList, view],
  );
  const displayTasks = useMemo(() => {
    const filtered = applyFilter(baseTasks, filter);
    return sortOverride === null ? filtered : applySort(filtered, sortOverride);
  }, [baseTasks, filter, sortOverride]);
  const sectionBy = useMemo(() => {
    if (view === undefined || view.presentation.group === "none") {
      return;
    }
    const group = view.presentation.group;
    return (task: Task): string => savedViewGroupLabel(task, group);
  }, [view]);

  const duplicate = useCallback(() => {
    if (view === undefined) return;
    void (async () => {
      const copy = await copyView(view.id);
      if (copy !== null) {
        navigation.replace("SavedView", { viewId: copy.id });
      }
    })();
  }, [copyView, navigation, view]);

  const confirmDelete = useCallback(() => {
    if (view === undefined) return;
    Alert.alert(
      `Delete “${view.name}”?`,
      "This removes the saved view from this device. Your tasks are not changed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              const deleted = await removeView(view.id);
              if (deleted) navigation.goBack();
            })();
          },
        },
      ],
    );
  }, [navigation, removeView, view]);

  useEffect(() => {
    if (view === undefined) return;
    navigation.setOptions({
      title: view.name,
      headerRight: () => (
        <View style={styles.headerActions}>
          {view.id === "job-search" ? (
            <Pressable
              style={styles.headerMenu}
              onPress={() => {
                navigation.navigate("JobSearchKanban");
              }}
              accessibilityRole="button"
              accessibilityLabel={`Open ${view.name} board`}
              testID="job-search-board"
            >
              <AppIcon name="columns" size={22} color={colors.text} />
            </Pressable>
          ) : null}
          <SavedViewHeaderMenu
            view={view}
            disabled={isSaving}
            color={colors.text}
            onEdit={() => {
              setEditorVisible(true);
            }}
            onDuplicate={duplicate}
            onDelete={confirmDelete}
          />
        </View>
      ),
    });
  }, [colors.text, confirmDelete, duplicate, navigation, isSaving, view]);

  const saveEditor = useCallback(
    async (definition: SavedViewDefinition): Promise<boolean> => {
      if (view === undefined) return false;
      return (await editView(view.id, definition)) !== null;
    },
    [editView, view],
  );

  if (isLoading && preferences === null) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>
          Loading view…
        </Text>
      </View>
    );
  }

  if (error !== null && preferences === null) {
    return (
      <View style={styles.centered}>
        <AppIcon name="alert-circle" size={32} color={colors.error} />
        <Text style={[typography.subheading, { color: colors.text }]}>
          This view could not load
        </Text>
        <Text style={[styles.centerCopy, { color: colors.textSecondary }]}>
          {error.message}
        </Text>
        <Pressable
          style={[styles.primaryButton, { backgroundColor: colors.primary }]}
          onPress={() => {
            void reload();
          }}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>Try Again</Text>
        </Pressable>
      </View>
    );
  }

  if (view === undefined) {
    return (
      <View style={styles.container}>
        <EmptyState
          title="Saved view not found"
          subtitle="It may have been deleted on this device."
          icon="bookmark"
        />
        <Pressable
          style={[styles.missingButton, { borderColor: colors.border }]}
          onPress={() => {
            navigation.goBack();
          }}
          accessibilityRole="button"
        >
          <Text style={[styles.missingButtonText, { color: colors.primary }]}>
            Back to Browse
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {error ? (
        <View
          style={[
            styles.inlineError,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
          accessibilityRole="alert"
        >
          <AppIcon name="alert-circle" size={18} color={colors.error} />
          <Text style={[styles.inlineErrorText, { color: colors.error }]}>
            {error.message}
          </Text>
        </View>
      ) : null}
      <FilterSortBar
        filter={filter}
        sort={sortOverride ?? visibleSort(view)}
        onFilterChange={setFilter}
        onSortChange={setSortOverride}
        availableProjects={tasks.projectNames}
        availableContexts={tasks.contextNames}
        availableTags={tasks.tagNames}
      />
      <TaskList
        tasks={displayTasks}
        onTaskPress={tasks.handlePress}
        onTaskToggle={tasks.handleToggle}
        onTaskDelete={tasks.handleDelete}
        onTaskSchedule={tasks.handleSchedule}
        dayCounts={tasks.dayCounts}
        pendingIds={tasks.pendingTaskIds}
        sectionBy={sectionBy}
        emptyTitle={`No tasks in ${view.name}`}
        emptySubtitle="Edit this view to broaden its filters."
        emptyIcon="filter"
      />

      <SavedViewEditorModal
        visible={editorVisible}
        view={view}
        availableProjects={tasks.projectNames}
        availableContexts={tasks.contextNames}
        availableTags={tasks.tagNames}
        isSaving={isSaving}
        errorMessage={error?.message}
        onClose={() => {
          setEditorVisible(false);
        }}
        onSave={saveEditor}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerMenu: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 32,
  },
  centerCopy: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  primaryButton: {
    minHeight: 44,
    justifyContent: "center",
    borderRadius: 10,
    paddingHorizontal: 18,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  missingButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  missingButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  inlineError: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    margin: 12,
    marginBottom: 0,
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  inlineErrorText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
});
