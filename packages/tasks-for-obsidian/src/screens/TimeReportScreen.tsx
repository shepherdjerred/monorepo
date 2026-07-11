import React, { useEffect, useState } from "react";
import { View, Text, FlatList, StyleSheet } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import type { TimeSummary } from "../domain/types";
import { useTaskNotesClient } from "../hooks/use-task-notes-client";
import { useSettings } from "../hooks/use-settings";
import { typography } from "../styles/typography";
import { formatDuration } from "../lib/utils";
import { EmptyState } from "../components/common/EmptyState";

type Props = NativeStackScreenProps<RootStackParamList, "TimeReport">;

type TimeReportItem = {
  taskId: string;
  taskTitle: string;
  totalMinutes: number;
};

export function TimeReportScreen(_props: Props) {
  const { colors } = useSettings();
  const client = useTaskNotesClient();
  const [summary, setSummary] = useState<TimeSummary | null>(null);

  useEffect(() => {
    if (!client) return;
    const fetchSummary = async () => {
      const result = await client.getTimeSummary();
      if (result.ok) setSummary(result.value);
    };
    void fetchSummary();
  }, [client]);

  const items: TimeReportItem[] = React.useMemo(() => {
    if (summary === null) return [];
    // v2 pre-aggregates per-task totals (topTasks), titles included.
    return summary.topTasks.map((t) => ({
      taskId: String(t.taskId),
      taskTitle: t.title,
      totalMinutes: t.minutes,
    }));
  }, [summary]);

  if (items.length === 0) {
    return (
      <EmptyState
        title="No time data"
        subtitle="Start tracking time on tasks to see a report"
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.totalRow, { backgroundColor: colors.surface }]}>
        <Text style={[typography.subheading, { color: colors.text }]}>
          Total
        </Text>
        <Text style={[typography.subheading, { color: colors.primary }]}>
          {formatDuration(summary?.totalTime ?? 0)}
        </Text>
      </View>
      <FlatList
        data={items}
        keyExtractor={(item) => item.taskId}
        renderItem={({ item }) => (
          <View style={[styles.row, { borderBottomColor: colors.borderLight }]}>
            <Text
              style={[
                typography.body,
                { color: colors.text },
                styles.taskTitle,
              ]}
              numberOfLines={1}
            >
              {item.taskTitle}
            </Text>
            <Text
              style={[typography.bodySmall, { color: colors.textSecondary }]}
            >
              {formatDuration(item.totalMinutes)}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  taskTitle: {
    flex: 1,
    marginRight: 12,
  },
});
