import React from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { colors } from "../styles/colors";
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
  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, value === tab.key && styles.activeTab]}
            onPress={() => onChange(tab.key)}
          >
            <Text
              style={[styles.tabText, value === tab.key && styles.activeTabText]}
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
    backgroundColor: colors.surface,
    borderBottomWidth: 3,
    borderBottomColor: colors.border,
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
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  activeTab: {
    backgroundColor: colors.primary,
  },
  tabText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    color: colors.textDark,
    textTransform: "uppercase",
  },
  activeTabText: {
    color: colors.textWhite,
  },
});
