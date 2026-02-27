import { ActionSheetIOS, Platform } from "react-native";
import type { SortConfig, SortField, SortDirection } from "../../domain/filters";

const SORT_OPTIONS: { field: SortField; label: string }[] = [
  { field: "dueDate", label: "Due Date" },
  { field: "priority", label: "Priority" },
  { field: "title", label: "Title" },
];

export function showSortPicker(
  sort: SortConfig,
  onSortChange: (sort: SortConfig) => void,
): void {
  if (Platform.OS === "ios") {
    const options = SORT_OPTIONS.map((o) => {
      const arrow = sort.field === o.field ? (sort.direction === "asc" ? " ↑" : " ↓") : "";
      return `${o.label}${arrow}`;
    });
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
        if (sort.field === selected.field) {
          const newDir: SortDirection = sort.direction === "asc" ? "desc" : "asc";
          onSortChange({ field: selected.field, direction: newDir });
        } else {
          onSortChange({ field: selected.field, direction: "asc" });
        }
      },
    );
  }
}
