import React from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { useTheme } from "../contexts/ThemeContext";
import { typography } from "../styles/typography";

export type FilterStatus = "all" | "running" | "idle" | "completed" | "archived";

type FilterTabsProps = {
  value: FilterStatus;
  onChange: (value: FilterStatus) => void;
};

const TABS: { key: FilterStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "running", label: "Running" },
  { key: "idle", label: "Idle" },
  { key: "completed", label: "Completed" },
  { key: "archived", label: "Archived" },
];

export function FilterTabs({ value, onChange }: FilterTabsProps) {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[
              styles.tab,
              { borderColor: colors.border, backgroundColor: colors.surface },
              value === tab.key && { backgroundColor: colors.primary },
            ]}
            onPress={() => onChange(tab.key)}
          >
            <Text
              style={[
                styles.tabText,
                { color: colors.textDark },
                value === tab.key && { color: colors.textWhite },
              ]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 3,
  },
  scrollContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderWidth: 2,
  },
  tabText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    textTransform: "uppercase",
  },
});
