import React from "react";
import {
  ActionSheetIOS,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type {
  SortConfig,
  SortField,
  SortDirection,
} from "../../domain/filters";
import { useSettings } from "../../hooks/use-settings";
import { typography } from "../../styles/typography";
import { AppIcon } from "../common/AppIcon";

const SORT_OPTIONS: { field: SortField; label: string }[] = [
  { field: "scheduled", label: "Planned" },
  { field: "dueDate", label: "Due Date" },
  { field: "priority", label: "Priority" },
  { field: "title", label: "Title" },
  { field: "created", label: "Created" },
  { field: "completed", label: "Completed" },
];

export function showSortPicker(
  sort: SortConfig | null,
  onSortChange: (sort: SortConfig) => void,
): void {
  if (Platform.OS !== "ios") {
    throw new Error("showSortPicker is only available on iOS");
  }
  const options = SORT_OPTIONS.map((option) => sortOptionLabel(sort, option));
  options.push("Cancel");

  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: "Sort by",
      options,
      cancelButtonIndex: options.length - 1,
    },
    (buttonIndex) => {
      if (buttonIndex >= SORT_OPTIONS.length) return;
      const selected = SORT_OPTIONS[buttonIndex];
      if (!selected) return;
      onSortChange(nextSort(sort, selected.field));
    },
  );
}

export function SortPickerModal({
  visible,
  sort,
  onSortChange,
  onClose,
}: {
  readonly visible: boolean;
  readonly sort: SortConfig | null;
  readonly onSortChange: (sort: SortConfig) => void;
  readonly onClose: () => void;
}) {
  const { colors } = useSettings();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={[typography.subheading, { color: colors.text }]}>
            Sort by
          </Text>
          {SORT_OPTIONS.map((option) => {
            const selected = sort?.field === option.field;
            return (
              <Pressable
                key={option.field}
                style={({ pressed }) => [
                  styles.option,
                  { borderBottomColor: colors.borderLight },
                  pressed && { backgroundColor: colors.surfaceElevated },
                ]}
                onPress={() => {
                  onSortChange(nextSort(sort, option.field));
                  onClose();
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={sortOptionLabel(sort, option)}
              >
                <Text style={[typography.body, { color: colors.text }]}>
                  {option.label}
                </Text>
                {selected ? (
                  <AppIcon
                    name={sort.direction === "asc" ? "arrow-up" : "arrow-down"}
                    size={18}
                    color={colors.primary}
                  />
                ) : null}
              </Pressable>
            );
          })}
          <Pressable
            style={styles.cancel}
            onPress={onClose}
            accessibilityRole="button"
          >
            <Text style={[typography.body, { color: colors.primary }]}>
              Cancel
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function sortOptionLabel(
  sort: SortConfig | null,
  option: (typeof SORT_OPTIONS)[number],
): string {
  const arrow =
    sort?.field === option.field
      ? sort.direction === "asc"
        ? " ↑"
        : " ↓"
      : "";
  return `${option.label}${arrow}`;
}

function nextSort(sort: SortConfig | null, field: SortField): SortConfig {
  const direction: SortDirection =
    sort?.field === field && sort.direction === "asc" ? "desc" : "asc";
  return { field, direction };
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    padding: 16,
    backgroundColor: "rgba(0, 0, 0, 0.35)",
  },
  card: {
    borderRadius: 16,
    paddingTop: 18,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  option: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cancel: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
});
