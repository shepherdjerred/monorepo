import type { SessionMode } from "./schemas.ts";

const MODE_ORDER: Record<SessionMode, number> = {
  full: 3,
  text_ai: 2,
  minimal_ai: 1,
  offline: 0,
};

const MODE_LABELS: Record<SessionMode, string> = {
  full: "Full (voice + AI)",
  text_ai: "Text AI",
  minimal_ai: "Minimal AI (timer + tests only)",
  offline: "Offline (timer only)",
};

export function getModeLabel(mode: SessionMode): string {
  return MODE_LABELS[mode];
}

export function canDowngrade(
  current: SessionMode,
  target: SessionMode,
): boolean {
  return MODE_ORDER[target] < MODE_ORDER[current];
}

export function downgrade(
  current: SessionMode,
  reason: string,
): { mode: SessionMode; message: string } {
  switch (current) {
    case "full":
      return {
        mode: "text_ai",
        message: `Downgraded to text mode: ${reason}`,
      };
    case "text_ai":
      return {
        mode: "minimal_ai",
        message: `Downgraded to minimal AI mode: ${reason}`,
      };
    case "minimal_ai":
      return {
        mode: "offline",
        message: `Downgraded to offline mode: ${reason}`,
      };
    case "offline":
      return {
        mode: "offline",
        message: `Already in offline mode (${reason})`,
      };
  }
}
