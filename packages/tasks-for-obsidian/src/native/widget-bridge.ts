import { NativeModules, Platform } from "react-native";
import { z } from "zod";

type WidgetTask = {
  id: string;
  title: string;
  priority: string;
  completed: boolean;
  due?: string | undefined;
  project?: string | undefined;
};

type WidgetStats = {
  total: number;
  overdue: number;
  today: number;
};

export type WidgetData = {
  todayTasks: WidgetTask[];
  stats: WidgetStats;
};

const BridgeSchema = z.object({
  updateWidgetData: z.function(),
});

export function updateWidgetData(data: WidgetData): void {
  if (Platform.OS !== "ios") return;
  const parsed = BridgeSchema.safeParse(NativeModules["WidgetBridge"]);
  if (parsed.success) {
    parsed.data.updateWidgetData(data);
  }
}
