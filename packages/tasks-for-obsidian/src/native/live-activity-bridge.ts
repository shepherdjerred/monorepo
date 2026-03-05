import { NativeModules, Platform } from "react-native";
import { z } from "zod";

const BridgeSchema = z.object({
  startTimeTracking: z.function(),
  updateTimeTracking: z.function(),
  stopTimeTracking: z.function(),
});

type Bridge = z.infer<typeof BridgeSchema>;

function getBridge(): Bridge | undefined {
  if (Platform.OS !== "ios") return undefined;
  const parsed = BridgeSchema.safeParse(NativeModules["LiveActivityBridge"]);
  return parsed.success ? parsed.data : undefined;
}

export async function startTimeTracking(
  taskId: string,
  title: string,
  project?: string,
): Promise<string | undefined> {
  const bridge = getBridge();
  if (!bridge) return undefined;
  const result: unknown = await bridge.startTimeTracking(
    taskId,
    title,
    project ?? null,
  );
  return typeof result === "string" ? result : undefined;
}

export async function updateTimeTracking(
  elapsedSeconds: number,
  isPaused: boolean,
): Promise<void> {
  const bridge = getBridge();
  if (!bridge) return;
  await bridge.updateTimeTracking(elapsedSeconds, isPaused);
}

export async function stopTimeTracking(elapsedSeconds: number): Promise<void> {
  const bridge = getBridge();
  if (!bridge) return;
  await bridge.stopTimeTracking(elapsedSeconds);
}
