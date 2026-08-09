import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SectionList,
  Text,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import type { CompositeScreenProps } from "@react-navigation/native";

import { AppIcon } from "../components/common/AppIcon";
import { Fab } from "../components/common/Fab";
import { BrowseRow } from "../components/saved-view/BrowseRow";
import type {
  BrowseItem,
  BrowseSection,
  DestinationItem,
  DimensionItem,
} from "../components/saved-view/browse-model";
import {
  buildBrowseSections,
  deriveBrowseProjects,
} from "../components/saved-view/browse-model";
import { CompletedTasksModal } from "../components/saved-view/CompletedTasksModal";
import { SavedViewEditorModal } from "../components/saved-view/SavedViewEditorModal";
import { deriveSavedViewTasks } from "../domain/saved-view-collection";
import { createCaptureSeed } from "../domain/quick-capture-seed";
import { sortSavedViews } from "../domain/saved-view-actions";
import type { SavedViewDefinition } from "../domain/saved-view-actions";
import type { SavedView } from "../domain/saved-views";
import { isActiveStatus, isCompletedStatus } from "../domain/status";
import { contextName, projectName, tagName } from "../domain/types";
import { localTodayYmd } from "../domain/recurrence";
import { useSavedViews } from "../hooks/use-saved-views";
import { useSettings } from "../hooks/use-settings";
import { useTaskListScreen } from "../hooks/use-task-list-screen";
import type { RootStackParamList } from "../navigation/types";
import type { MainTabScreenProps } from "../navigation/main-tabs";
import { typography } from "../styles/typography";
import { styles } from "./BrowseScreen.styles";

type Props = CompositeScreenProps<
  MainTabScreenProps<"Browse">,
  NativeStackScreenProps<RootStackParamList>
>;

export function BrowseScreen({ navigation }: Props) {
  const { colors } = useSettings();
  const {
    taskList,
    projectNames,
    contextNames,
    tagNames,
    pendingTaskIds,
    handlePress,
    handleStatusToggle,
    handleDelete,
  } = useTaskListScreen(navigation);
  const {
    preferences,
    views,
    error,
    isLoading,
    isSaving,
    reload,
    createView,
    editView,
    copyView,
    removeView,
    reorderView,
    favoriteView,
  } = useSavedViews();
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingView, setEditingView] = useState<SavedView | null>(null);
  const [completedVisible, setCompletedVisible] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const activeTasks = useMemo(
    () => taskList.filter((task) => isActiveStatus(task.status)),
    [taskList],
  );
  const completedTasks = useMemo(
    () => taskList.filter((task) => isCompletedStatus(task.status)),
    [taskList],
  );
  const projects = useMemo(() => deriveBrowseProjects(taskList), [taskList]);
  const orderedViews = useMemo(() => sortSavedViews(views), [views]);
  const savedViewCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const referenceDay = localTodayYmd();
    for (const view of orderedViews) {
      counts.set(
        view.id,
        deriveSavedViewTasks(taskList, view, referenceDay).length,
      );
    }
    return counts;
  }, [orderedViews, taskList]);
  const sections = useMemo(
    () =>
      buildBrowseSections({
        views: orderedViews,
        viewCounts: savedViewCounts,
        activeTasks,
        completedCount: completedTasks.length,
        projects,
        contextNames,
        tagNames,
      }),
    [
      activeTasks,
      completedTasks.length,
      contextNames,
      orderedViews,
      projects,
      savedViewCounts,
      tagNames,
    ],
  );

  const openEditor = useCallback((view: SavedView | null) => {
    setEditingView(view);
    setEditorVisible(true);
  }, []);
  const confirmDelete = useCallback(
    (view: SavedView) => {
      Alert.alert(
        `Delete “${view.name}”?`,
        "This removes the saved view from this device. Your tasks are not changed.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              void removeView(view.id);
            },
          },
        ],
      );
    },
    [removeView],
  );
  const handleSavedViewAction = useCallback(
    (view: SavedView, action: string) => {
      switch (action) {
        case "edit":
          openEditor(view);
          return;
        case "favorite":
          void favoriteView(view.id, !view.favorite);
          return;
        case "duplicate":
          void copyView(view.id);
          return;
        case "move-up":
          void reorderView(view.id, "up");
          return;
        case "move-down":
          void reorderView(view.id, "down");
          return;
        case "delete":
          confirmDelete(view);
          return;
      }
    },
    [confirmDelete, copyView, favoriteView, openEditor, reorderView],
  );
  const openDimension = useCallback(
    (dimension: DimensionItem["dimension"], value: string) => {
      switch (dimension) {
        case "project":
          navigation.navigate("ProjectDetail", {
            projectName: projectName(value),
          });
          return;
        case "context":
          navigation.navigate("ContextDetail", {
            contextName: contextName(value),
          });
          return;
        case "tag":
          navigation.navigate("TagDetail", { tagName: tagName(value) });
          return;
      }
    },
    [navigation],
  );
  const openDestination = useCallback(
    (destination: DestinationItem["destination"]) => {
      switch (destination) {
        case "search":
          navigation.navigate("Search");
          return;
        case "completed":
          setCompletedVisible(true);
          return;
        case "reports":
          navigation.navigate("TimeReport");
          return;
        case "settings":
          navigation.navigate("Settings");
          return;
      }
    },
    [navigation],
  );
  const renderItem = useCallback(
    ({ item }: { item: BrowseItem }) => (
      <BrowseRow
        item={item}
        views={orderedViews}
        isSaving={isSaving}
        onOpenSavedView={(id) => {
          navigation.navigate("SavedView", { viewId: id });
        }}
        onSavedViewAction={handleSavedViewAction}
        onCreateView={() => {
          openEditor(null);
        }}
        onOpenDimension={openDimension}
        onOpenDestination={openDestination}
      />
    ),
    [
      handleSavedViewAction,
      isSaving,
      navigation,
      openDestination,
      openDimension,
      openEditor,
      orderedViews,
    ],
  );
  const renderSectionHeader = useCallback(
    ({ section }: { section: BrowseSection }) => (
      <View
        style={[styles.sectionHeader, { backgroundColor: colors.background }]}
      >
        <Text style={[typography.label, { color: colors.textSecondary }]}>
          {section.title}
        </Text>
      </View>
    ),
    [colors],
  );
  const saveEditor = useCallback(
    async (definition: SavedViewDefinition): Promise<boolean> => {
      const saved =
        editingView === null
          ? await createView(definition)
          : await editView(editingView.id, definition);
      return saved !== null;
    },
    [createView, editView, editingView],
  );

  if (isLoading && preferences === null) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>
          Loading views…
        </Text>
      </View>
    );
  }
  if (error !== null && preferences === null) {
    return (
      <View style={styles.centered}>
        <AppIcon name="alert-circle" size={32} color={colors.error} />
        <Text style={[typography.subheading, { color: colors.text }]}>
          Saved views could not load
        </Text>
        <Text style={[styles.errorCopy, { color: colors.textSecondary }]}>
          {error.message}
        </Text>
        <Pressable
          style={[styles.retryButton, { backgroundColor: colors.primary }]}
          onPress={() => {
            void reload();
          }}
          accessibilityRole="button"
        >
          <Text style={styles.retryText}>Try Again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        stickySectionHeadersEnabled={false}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          error ? (
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
          ) : null
        }
      />
      <Fab
        onPress={() => {
          navigation.navigate("QuickAdd", createCaptureSeed());
        }}
      />
      <SavedViewEditorModal
        visible={editorVisible}
        view={editingView}
        availableProjects={projectNames}
        availableContexts={contextNames}
        availableTags={tagNames}
        isSaving={isSaving}
        errorMessage={error?.message}
        onClose={() => {
          setEditorVisible(false);
        }}
        onSave={saveEditor}
      />
      <CompletedTasksModal
        visible={completedVisible}
        tasks={completedTasks}
        pendingIds={pendingTaskIds}
        onClose={() => {
          setCompletedVisible(false);
        }}
        onTaskPress={handlePress}
        onTaskToggle={handleStatusToggle}
        onTaskDelete={handleDelete}
      />
    </View>
  );
}
