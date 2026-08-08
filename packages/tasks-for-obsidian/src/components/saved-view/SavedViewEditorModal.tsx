import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { projectMatches } from "tasknotes-types/v2";

import {
  deriveProjectOptions,
  projectIdentityLabel,
} from "../../domain/project-options";
import type { SavedViewDefinition } from "../../domain/saved-view-actions";
import type { SavedView, SavedViewQuery } from "../../domain/saved-views";
import { ALL_PRIORITIES, PRIORITY_LABELS } from "../../domain/priority";
import type { Priority } from "../../domain/priority";
import { STATUS_LABELS } from "../../domain/status";
import type { TaskStatus } from "../../domain/status";
import { useSettings } from "../../hooks/use-settings";
import { feedbackSelection } from "../../lib/feedback";
import { MultiSelectSection, toggleInArray } from "../input/MultiSelectSection";
import { SAVED_VIEW_SYMBOL_OPTIONS, SavedViewIcon } from "./SavedViewIcon";
import { styles } from "./SavedViewEditorModal.styles";
import {
  SAVED_VIEW_COMPLETION_OPTIONS,
  SAVED_VIEW_SORT_OPTIONS,
  SAVED_VIEW_STATUS_OPTIONS,
  SAVED_VIEW_TINT_OPTIONS,
  definitionFromSavedView,
  updateSavedViewPresentationSort,
} from "./saved-view-editor-model";

type Props = {
  readonly visible: boolean;
  readonly view: SavedView | null;
  readonly availableProjects: readonly string[];
  readonly availableContexts: readonly string[];
  readonly availableTags: readonly string[];
  readonly isSaving: boolean;
  readonly errorMessage?: string | undefined;
  readonly onClose: () => void;
  readonly onSave: (definition: SavedViewDefinition) => Promise<boolean>;
};

export function SavedViewEditorModal({
  visible,
  view,
  availableProjects,
  availableContexts,
  availableTags,
  isSaving,
  errorMessage,
  onClose,
  onSave,
}: Props) {
  const { colors } = useSettings();
  const insets = useSafeAreaInsets();
  const [definition, setDefinition] = useState(() =>
    definitionFromSavedView(view),
  );
  const projectOptions = useMemo(
    () =>
      deriveProjectOptions([
        ...availableProjects,
        ...definition.query.projects,
      ]),
    [availableProjects, definition.query.projects],
  );

  useEffect(() => {
    if (visible) setDefinition(definitionFromSavedView(view));
  }, [view, visible]);

  const updateQuery = (query: SavedViewQuery): void => {
    setDefinition((current) => ({ ...current, query }));
  };

  const save = (): void => {
    const trimmedName = definition.name.trim();
    if (isSaving || trimmedName.length === 0) return;

    void (async () => {
      const saved = await onSave({ ...definition, name: trimmedName });
      if (saved) onClose();
    })();
  };

  const requestClose = (): void => {
    if (!isSaving) onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="formSheet"
      allowSwipeDismissal={!isSaving}
      onRequestClose={requestClose}
    >
      <View
        style={[
          styles.container,
          {
            backgroundColor: colors.background,
            paddingTop: Math.max(insets.top, 8),
          },
        ]}
      >
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable
            style={styles.headerAction}
            onPress={onClose}
            disabled={isSaving}
            accessibilityRole="button"
            accessibilityLabel="Cancel editing saved view"
            testID="saved-view-editor-cancel"
          >
            <Text style={[styles.headerButton, { color: colors.primary }]}>
              Cancel
            </Text>
          </Pressable>
          <Text style={[styles.title, { color: colors.text }]}>
            {view === null ? "New View" : "Edit View"}
          </Text>
          <Pressable
            style={styles.headerAction}
            onPress={save}
            disabled={definition.name.trim().length === 0 || isSaving}
            accessibilityRole="button"
            accessibilityLabel="Save view"
            testID="saved-view-editor-save"
          >
            {isSaving ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text
                style={[
                  styles.headerButton,
                  styles.saveButton,
                  {
                    color:
                      definition.name.trim().length === 0
                        ? colors.textTertiary
                        : colors.primary,
                  },
                ]}
              >
                Save
              </Text>
            )}
          </Pressable>
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.content,
            { paddingBottom: Math.max(insets.bottom, 24) },
          ]}
        >
          {errorMessage ? (
            <Text
              style={[
                styles.error,
                {
                  color: colors.error,
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
              accessibilityRole="alert"
            >
              {errorMessage}
            </Text>
          ) : null}

          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
            Name
          </Text>
          <TextInput
            style={[
              styles.nameInput,
              {
                color: colors.text,
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
            value={definition.name}
            onChangeText={(name) => {
              setDefinition((current) => ({ ...current, name }));
            }}
            placeholder="View name"
            placeholderTextColor={colors.textTertiary}
            maxLength={100}
            returnKeyType="done"
            accessibilityLabel="Saved view name"
            testID="saved-view-name"
          />

          <View style={styles.section}>
            <Text
              style={[styles.sectionLabel, { color: colors.textSecondary }]}
            >
              Symbol
            </Text>
            <View style={styles.choiceRow}>
              {SAVED_VIEW_SYMBOL_OPTIONS.map((option) => {
                const selected = definition.symbol === option.symbol;
                return (
                  <Pressable
                    key={option.symbol}
                    style={[
                      styles.iconChoice,
                      {
                        backgroundColor: selected
                          ? definition.tint
                          : colors.surface,
                        borderColor: selected ? definition.tint : colors.border,
                      },
                    ]}
                    onPress={() => {
                      feedbackSelection();
                      setDefinition((current) => ({
                        ...current,
                        symbol: option.symbol,
                      }));
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${option.label} symbol`}
                  >
                    <SavedViewIcon
                      symbol={option.symbol}
                      size={20}
                      color={selected ? "#ffffff" : colors.textSecondary}
                    />
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.section}>
            <Text
              style={[styles.sectionLabel, { color: colors.textSecondary }]}
            >
              Color
            </Text>
            <View style={styles.choiceRow}>
              {SAVED_VIEW_TINT_OPTIONS.map((tint) => {
                const selected = definition.tint === tint;
                return (
                  <Pressable
                    key={tint}
                    style={[
                      styles.tintChoice,
                      { backgroundColor: tint },
                      selected && {
                        borderColor: colors.text,
                        borderWidth: 3,
                      },
                    ]}
                    onPress={() => {
                      feedbackSelection();
                      setDefinition((current) => ({ ...current, tint }));
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Color ${tint}`}
                  />
                );
              })}
            </View>
          </View>

          <View style={[styles.switchRow, { borderColor: colors.border }]}>
            <View style={styles.switchCopy}>
              <Text style={[styles.rowTitle, { color: colors.text }]}>
                Favorite
              </Text>
              <Text
                style={[styles.rowSubtitle, { color: colors.textSecondary }]}
              >
                Show this view near the top of Browse
              </Text>
            </View>
            <Switch
              value={definition.favorite}
              onValueChange={(favorite) => {
                setDefinition((current) => ({ ...current, favorite }));
              }}
              trackColor={{ false: colors.border, true: colors.primary }}
              accessibilityLabel="Favorite saved view"
            />
          </View>

          <Text style={[styles.groupTitle, { color: colors.text }]}>Tasks</Text>
          <Text style={[styles.groupSubtitle, { color: colors.textSecondary }]}>
            A task must match every section that has a selection.
          </Text>

          <View style={styles.segmentedRow} accessibilityRole="radiogroup">
            {SAVED_VIEW_COMPLETION_OPTIONS.map((option) => {
              const selected = definition.query.completed === option.value;
              return (
                <Pressable
                  key={option.value}
                  style={[
                    styles.segment,
                    {
                      backgroundColor: selected
                        ? colors.primary
                        : colors.surface,
                      borderColor: selected ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => {
                    feedbackSelection();
                    updateQuery({
                      ...definition.query,
                      completed: option.value,
                    });
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      { color: selected ? "#ffffff" : colors.text },
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <MultiSelectSection
            title="Projects"
            items={availableProjects}
            selected={definition.query.projects}
            labelFn={(project) => projectIdentityLabel(project, projectOptions)}
            matches={(selected, item) => projectMatches(selected, item)}
            onToggle={(project) => {
              updateQuery({
                ...definition.query,
                projects: toggleInArray(definition.query.projects, project),
              });
            }}
          />
          <MultiSelectSection
            title="Contexts"
            items={availableContexts}
            selected={definition.query.contexts}
            labelFn={(context) => `@${context}`}
            onToggle={(context) => {
              updateQuery({
                ...definition.query,
                contexts: toggleInArray(definition.query.contexts, context),
              });
            }}
          />
          <MultiSelectSection
            title="Tags"
            items={availableTags}
            selected={definition.query.tags}
            labelFn={(tag) => `#${tag}`}
            onToggle={(tag) => {
              updateQuery({
                ...definition.query,
                tags: toggleInArray(definition.query.tags, tag),
              });
            }}
          />
          <MultiSelectSection
            title="Status"
            items={SAVED_VIEW_STATUS_OPTIONS}
            selected={definition.query.statuses}
            labelFn={(status) => STATUS_LABELS[status]}
            onToggle={(status: TaskStatus) => {
              updateQuery({
                ...definition.query,
                statuses: toggleInArray(definition.query.statuses, status),
              });
            }}
          />
          <MultiSelectSection
            title="Priority"
            items={ALL_PRIORITIES}
            selected={definition.query.priorities}
            labelFn={(priority) => PRIORITY_LABELS[priority]}
            onToggle={(priority: Priority) => {
              updateQuery({
                ...definition.query,
                priorities: toggleInArray(
                  definition.query.priorities,
                  priority,
                ),
              });
            }}
          />

          <Text style={[styles.groupTitle, { color: colors.text }]}>
            Display
          </Text>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
            Sort by
          </Text>
          <View style={styles.wrapRow}>
            {SAVED_VIEW_SORT_OPTIONS.map((option) => {
              const selected =
                definition.presentation.sort.field === option.value;
              return (
                <Pressable
                  key={option.value}
                  style={[
                    styles.optionChip,
                    {
                      backgroundColor: selected
                        ? colors.primary
                        : colors.surface,
                      borderColor: selected ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => {
                    feedbackSelection();
                    setDefinition((current) => ({
                      ...current,
                      presentation: updateSavedViewPresentationSort(
                        current.presentation,
                        option.value,
                      ),
                    }));
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <Text
                    style={[
                      styles.optionText,
                      { color: selected ? "#ffffff" : colors.text },
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
