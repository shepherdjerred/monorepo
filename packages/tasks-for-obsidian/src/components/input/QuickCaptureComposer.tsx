import React, { useEffect, useMemo, useRef } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { FeatherIconName } from "@react-native-vector-icons/feather";

import type {
  CaptureDraft,
  CaptureMetadataChip,
} from "../../domain/quick-capture";
import type { ProjectOption } from "../../domain/project-options";
import {
  applyCaptureSuggestion,
  buildCaptureSuggestions,
} from "../../domain/quick-capture-autocomplete";
import { feedbackSelection } from "../../lib/feedback";
import { useSettings } from "../../hooks/use-settings";
import { typography } from "../../styles/typography";
import { AppIcon } from "../common/AppIcon";
import { QuickCaptureProjectMenu } from "./QuickCaptureProjectMenu";

type QuickCaptureComposerProps = {
  readonly value: string;
  readonly draft: CaptureDraft;
  readonly onChange: (value: string) => void;
  readonly onChipPress: (chip: CaptureMetadataChip) => void;
  readonly onProjectChange: (project: string | undefined) => void;
  readonly onSave: () => void;
  readonly onSaveAndAddAnother: () => void;
  readonly saving: boolean;
  readonly focusRequestKey: number;
  readonly message?: string | undefined;
  readonly projectOptions: readonly ProjectOption[];
  readonly availableContexts: readonly string[];
  readonly availableTags: readonly string[];
};

export function QuickCaptureComposer({
  value,
  draft,
  onChange,
  onChipPress,
  onProjectChange,
  onSave,
  onSaveAndAddAnother,
  saving,
  focusRequestKey,
  message,
  projectOptions,
  availableContexts,
  availableTags,
}: QuickCaptureComposerProps) {
  const inputRef = useRef<TextInput>(null);
  const { colors, isDarkMode } = useSettings();
  const suggestions = useMemo(
    () =>
      buildCaptureSuggestions(
        value,
        projectOptions,
        availableContexts,
        availableTags,
      ),
    [value, projectOptions, availableContexts, availableTags],
  );
  const canSave = draft.title.trim().length > 0 && !saving;

  useEffect(() => {
    if (focusRequestKey > 0) inputRef.current?.focus();
  }, [focusRequestKey]);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      <View
        style={[
          styles.composer,
          {
            backgroundColor: colors.surfaceElevated,
            borderColor: colors.border,
          },
        ]}
      >
        <TextInput
          ref={inputRef}
          style={[styles.input, { color: colors.text }]}
          value={value}
          onChangeText={onChange}
          onSubmitEditing={onSave}
          placeholder="What needs doing?"
          placeholderTextColor={colors.textTertiary}
          selectionColor={colors.primary}
          keyboardAppearance={isDarkMode ? "dark" : "light"}
          multiline
          submitBehavior="submit"
          returnKeyType="done"
          autoFocus
          accessibilityLabel="Task name and natural language details"
          accessibilityHint="Add a date, project, context, tag, or priority while typing"
          testID="quick-add-input"
        />

        <Text
          style={[
            typography.caption,
            styles.helpText,
            { color: colors.textTertiary },
          ]}
        >
          Try tomorrow, p:&quot;Big Project&quot;, @context, #tag, or !high
        </Text>

        {suggestions.length > 0 ? (
          <View
            style={[styles.suggestions, { borderColor: colors.borderLight }]}
            testID="nlp-suggestions"
          >
            {suggestions.map((suggestion) => (
              <Pressable
                key={suggestion.key}
                style={({ pressed }) => [
                  styles.suggestion,
                  { borderBottomColor: colors.borderLight },
                  pressed && { backgroundColor: colors.surface },
                ]}
                onPress={() => {
                  feedbackSelection();
                  onChange(applyCaptureSuggestion(value, suggestion));
                }}
                accessibilityRole="button"
                accessibilityLabel={`Autocomplete ${suggestion.label}`}
                testID={`nlp-suggestion-${suggestion.label}`}
              >
                <AppIcon
                  name="corner-down-left"
                  size={16}
                  color={colors.primary}
                />
                <Text style={[typography.body, { color: colors.text }]}>
                  {suggestion.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <QuickCaptureProjectMenu
          selectedProject={draft.seed.project}
          projectOptions={projectOptions}
          onChange={onProjectChange}
        />

        {draft.chips.length > 0 ? (
          <View style={styles.chips} accessibilityLabel="Parsed task details">
            {draft.chips.map((chip) => (
              <Pressable
                key={chip.id}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                  pressed && { opacity: 0.65 },
                ]}
                onPress={() => {
                  onChipPress(chip);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${chip.label}, ${chip.origin === "seed" ? "source default" : "parsed"}`}
                accessibilityHint={
                  chip.origin === "seed"
                    ? `Clear the ${chip.label} default`
                    : `Keep ${chip.source.sourceText} in the task title instead`
                }
                testID={
                  chip.origin === "seed"
                    ? `quick-add-seed-${chip.seedField}`
                    : `quick-add-chip-${chip.kind}-${chip.value}`
                }
              >
                <AppIcon
                  name={chipIcon(chip.kind)}
                  size={15}
                  color={colors.primary}
                />
                <Text
                  style={[styles.chipText, { color: colors.text }]}
                  numberOfLines={1}
                >
                  {chip.label}
                </Text>
                <AppIcon
                  name="rotate-ccw"
                  size={13}
                  color={colors.textTertiary}
                />
              </Pressable>
            ))}
          </View>
        ) : null}

        {message ? (
          <Text
            style={[
              typography.bodySmall,
              styles.message,
              { color: colors.error },
            ]}
            accessibilityLiveRegion="polite"
            testID="quick-add-message"
          >
            {message}
          </Text>
        ) : null}

        <Pressable
          style={({ pressed }) => [
            styles.saveButton,
            { backgroundColor: canSave ? colors.primary : colors.border },
            pressed && canSave && { opacity: 0.78 },
          ]}
          onPress={onSave}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityLabel={saving ? "Saving task" : "Save task"}
          accessibilityState={{ disabled: !canSave, busy: saving }}
          testID="quick-add-submit"
        >
          {saving ? (
            <View style={styles.savingContent}>
              <ActivityIndicator color="#ffffff" />
              <Text style={styles.saveText}>Saving…</Text>
            </View>
          ) : (
            <Text style={styles.saveText}>Save</Text>
          )}
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.saveAnotherButton,
            { borderColor: colors.border },
            pressed && canSave && { backgroundColor: colors.surface },
          ]}
          onPress={onSaveAndAddAnother}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityLabel="Save task and add another"
          accessibilityState={{ disabled: !canSave, busy: saving }}
          testID="quick-add-save-another"
        >
          <Text
            style={[
              styles.saveAnotherText,
              { color: canSave ? colors.primary : colors.textTertiary },
            ]}
          >
            Save &amp; Add Another
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function chipIcon(kind: CaptureMetadataChip["kind"]): FeatherIconName {
  switch (kind) {
    case "deadline":
      return "calendar";
    case "scheduled":
      return "clock";
    case "recurrence":
      return "repeat";
    case "project":
      return "briefcase";
    case "priority":
      return "flag";
    case "context":
      return "at-sign";
    case "tag":
      return "hash";
  }
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  composer: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 12,
  },
  input: {
    minHeight: 72,
    maxHeight: 132,
    padding: 0,
    fontSize: 20,
    lineHeight: 27,
    fontWeight: "500",
    textAlignVertical: "top",
  },
  helpText: {
    marginTop: -4,
  },
  suggestions: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  suggestion: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    minHeight: 44,
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: "600",
  },
  message: {
    marginTop: -2,
  },
  saveButton: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  saveText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "600",
  },
  saveAnotherButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  saveAnotherText: {
    fontSize: 16,
    fontWeight: "600",
  },
  savingContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
});
