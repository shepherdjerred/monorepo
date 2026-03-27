import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  Modal,
  ScrollView,
  StyleSheet,
} from "react-native";
import { AppIcon } from "../common/AppIcon";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSettings } from "../../hooks/use-settings";
import type { FilterConfig } from "../../domain/filters";
import type { TaskStatus } from "../../domain/status";
import { STATUS_LABELS } from "../../domain/status";
import { PRIORITY_LABELS, ALL_PRIORITIES } from "../../domain/priority";

type Props = {
  visible: boolean;
  filter: FilterConfig;
  onFilterChange: (filter: FilterConfig) => void;
  onClose: () => void;
  availableProjects: readonly string[];
  availableContexts: readonly string[];
  availableTags: readonly string[];
};

const ALL_STATUSES: TaskStatus[] = [
  "open",
  "in-progress",
  "done",
  "cancelled",
  "waiting",
  "delegated",
];

function toggleInArray<T>(arr: readonly T[] | undefined, item: T): T[] {
  const current = arr ?? [];
  return current.includes(item)
    ? current.filter((x) => x !== item)
    : [...current, item];
}

function MultiSelectSection<T extends string>({
  title,
  items,
  selected,
  labelFn,
  onToggle,
  colors,
}: {
  title: string;
  items: readonly T[];
  selected: readonly T[] | undefined;
  labelFn: (item: T) => string;
  onToggle: (item: T) => void;
  colors: {
    text: string;
    textSecondary: string;
    primary: string;
    surface: string;
    border: string;
    borderLight: string;
  };
}) {
  if (items.length === 0) return null;
  return (
    <View style={sectionStyles.section}>
      <Text
        style={[sectionStyles.sectionTitle, { color: colors.textSecondary }]}
      >
        {title}
      </Text>
      <View style={sectionStyles.chips}>
        {items.map((item) => {
          const isSelected = selected?.includes(item) ?? false;
          return (
            <Pressable
              key={item}
              style={[
                sectionStyles.chip,
                {
                  backgroundColor: isSelected ? colors.primary : colors.surface,
                  borderColor: isSelected ? colors.primary : colors.border,
                },
              ]}
              onPress={() => {
                onToggle(item);
              }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isSelected }}
              accessibilityLabel={labelFn(item)}
            >
              <Text
                style={[
                  sectionStyles.chipText,
                  { color: isSelected ? "#ffffff" : colors.text },
                ]}
              >
                {labelFn(item)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function FilterModal({
  visible,
  filter,
  onFilterChange,
  onClose,
  availableProjects,
  availableContexts,
  availableTags,
}: Props) {
  const { colors } = useSettings();
  const insets = useSafeAreaInsets();
  const [local, setLocal] = useState(filter);

  const handleOpen = useCallback(() => {
    setLocal(filter);
  }, [filter]);

  const handleApply = () => {
    onFilterChange(local);
    onClose();
  };

  const handleClear = () => {
    setLocal({});
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      onShow={handleOpen}
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View
        style={[
          styles.container,
          {
            backgroundColor: colors.background,
            marginTop: Math.max(insets.top, 44),
          },
        ]}
      >
        <View style={styles.grabberRow}>
          <View
            style={[styles.grabber, { backgroundColor: colors.textTertiary }]}
          />
        </View>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close filters"
          >
            <AppIcon name="x" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.title, { color: colors.text }]}>Filters</Text>
          <Pressable
            onPress={handleClear}
            accessibilityRole="button"
            accessibilityLabel="Clear all filters"
          >
            <Text style={{ color: colors.primary, fontSize: 15 }}>Clear</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <MultiSelectSection
            title="Projects"
            items={availableProjects}
            selected={local.projects}
            labelFn={(p) => p}
            onToggle={(p) => {
              setLocal((prev) => ({
                ...prev,
                projects: toggleInArray(prev.projects, p),
              }));
            }}
            colors={colors}
          />
          <MultiSelectSection
            title="Contexts"
            items={availableContexts}
            selected={local.contexts}
            labelFn={(c) => `@${c}`}
            onToggle={(c) => {
              setLocal((prev) => ({
                ...prev,
                contexts: toggleInArray(prev.contexts, c),
              }));
            }}
            colors={colors}
          />
          <MultiSelectSection
            title="Tags"
            items={availableTags}
            selected={local.tags}
            labelFn={(t) => `#${t}`}
            onToggle={(t) => {
              setLocal((prev) => ({
                ...prev,
                tags: toggleInArray(prev.tags, t),
              }));
            }}
            colors={colors}
          />
          <MultiSelectSection
            title="Status"
            items={ALL_STATUSES}
            selected={local.statuses}
            labelFn={(s) => STATUS_LABELS[s]}
            onToggle={(s) => {
              setLocal((prev) => ({
                ...prev,
                statuses: toggleInArray(prev.statuses, s),
              }));
            }}
            colors={colors}
          />
          <MultiSelectSection
            title="Priority"
            items={ALL_PRIORITIES}
            selected={local.priorities}
            labelFn={(p) => PRIORITY_LABELS[p]}
            onToggle={(p) => {
              setLocal((prev) => ({
                ...prev,
                priorities: toggleInArray(prev.priorities, p),
              }));
            }}
            colors={colors}
          />
        </ScrollView>

        <Pressable
          style={[styles.applyButton, { backgroundColor: colors.primary }]}
          onPress={handleApply}
          accessibilityRole="button"
          accessibilityLabel="Apply filters"
        >
          <Text style={styles.applyText}>Apply Filters</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const sectionStyles = StyleSheet.create({
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "500",
  },
});

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  container: {
    flex: 1,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: "hidden",
  },
  grabberRow: {
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 4,
  },
  grabber: {
    width: 36,
    height: 5,
    borderRadius: 2.5,
    opacity: 0.4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
  },
  content: {
    padding: 16,
  },
  applyButton: {
    margin: 16,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  applyText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});
