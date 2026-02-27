import React, { useState } from "react";
import { View, Pressable, Text, StyleSheet } from "react-native";
import { AppIcon } from "../common/AppIcon";
import { useSettings } from "../../hooks/use-settings";
import { type FilterConfig, type SortConfig, countActiveFilters } from "../../domain/filters";
import { showSortPicker } from "./SortPicker";
import { FilterModal } from "./FilterModal";

type Props = {
  filter: FilterConfig;
  sort: SortConfig;
  onFilterChange: (filter: FilterConfig) => void;
  onSortChange: (sort: SortConfig) => void;
  availableProjects: readonly string[];
  availableContexts: readonly string[];
  availableTags: readonly string[];
};

export function FilterSortBar({ filter, sort, onFilterChange, onSortChange, availableProjects, availableContexts, availableTags }: Props) {
  const { colors } = useSettings();
  const [showFilter, setShowFilter] = useState(false);
  const activeCount = countActiveFilters(filter);

  return (
    <>
      <View style={[styles.bar, { borderBottomColor: colors.borderLight }]}>
        <Pressable
          style={[styles.button, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => { showSortPicker(sort, onSortChange); }}
          accessibilityRole="button"
          accessibilityLabel="Sort options"
        >
          <AppIcon name="sliders" size={14} color={colors.textSecondary} />
          <Text style={[styles.buttonText, { color: colors.textSecondary }]}>Sort</Text>
        </Pressable>
        <Pressable
          style={[styles.button, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => { setShowFilter(true); }}
          accessibilityRole="button"
          accessibilityLabel={`Filters${activeCount > 0 ? `, ${activeCount} active` : ""}`}
        >
          <AppIcon name="filter" size={14} color={activeCount > 0 ? colors.primary : colors.textSecondary} />
          <Text style={[styles.buttonText, { color: activeCount > 0 ? colors.primary : colors.textSecondary }]}>
            Filter
          </Text>
          {activeCount > 0 ? (
            <View style={[styles.badge, { backgroundColor: colors.primary }]}>
              <Text style={styles.badgeText}>{activeCount}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      <FilterModal
        visible={showFilter}
        filter={filter}
        onFilterChange={onFilterChange}
        onClose={() => { setShowFilter(false); }}
        availableProjects={availableProjects}
        availableContexts={availableContexts}
        availableTags={availableTags}
      />
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  buttonText: {
    fontSize: 13,
    fontWeight: "500",
  },
  badge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 2,
  },
  badgeText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "700",
  },
});
