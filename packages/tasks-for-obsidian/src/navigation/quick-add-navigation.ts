import type { CaptureSeed } from "../domain/quick-capture-seed";

export function quickAddCaptureKey(
  routeKey: string,
  seed: CaptureSeed,
): string {
  return `${routeKey}:${JSON.stringify(seed)}`;
}

export function quickAddDismissTarget(canGoBack: boolean): "back" | "main" {
  return canGoBack ? "back" : "main";
}
