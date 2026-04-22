import { NativeModules, Platform } from "react-native";
import { z } from "zod";

type StartFn = (
  taskId: string,
  title: string,
  project: string | null,
) => Promise<unknown>;
type UpdateFn = (elapsedSeconds: number, isPaused: boolean) => Promise<unknown>;
type StopFn = (elapsedSeconds: number) => Promise<unknown>;

const isFn = (v: unknown): boolean => typeof v === "function";

const BridgeSchema = z.object({
  startTimeTracking: z.custom<StartFn>(isFn),
  updateTimeTracking: z.custom<UpdateFn>(isFn),
  stopTimeTracking: z.custom<StopFn>(isFn),
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
