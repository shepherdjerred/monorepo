import { NativeModules, Platform } from "react-native";
import { z } from "zod";

import type { WidgetDataEnvelope } from "../domain/widget-data";

type UpdateFn = (data: WidgetDataEnvelope) => void;

const isFn = (v: unknown): boolean => typeof v === "function";

const BridgeSchema = z.object({
  updateWidgetData: z.custom<UpdateFn>(isFn),
});

export function updateWidgetData(data: WidgetDataEnvelope): void {
  if (Platform.OS !== "ios") return;
  const parsed = BridgeSchema.safeParse(NativeModules["WidgetBridge"]);
  if (parsed.success) {
    parsed.data.updateWidgetData(data);
  }
}
