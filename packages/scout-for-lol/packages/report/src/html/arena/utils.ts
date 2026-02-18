import { type ArenaPlacement, type Augment } from "@scout-for-lol/data";

export function formatDuration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${String(minutes)}m ${String(secs)}s`;
}

export function filterDisplayAugments(augs: Augment[]) {
  return augs.filter((a) => (a.type === "full" ? true : a.id > 0));
}

function getMedalBorder(placement: ArenaPlacement): string {
  if (placement === 1) {
    return "2px solid rgba(255, 215, 0, 0.3)";
  }
  if (placement === 2) {
    return "2px solid rgba(192, 192, 192, 0.3)";
  }
  if (placement === 3) {
    return "2px solid rgba(205, 127, 50, 0.3)";
  }
  return "2px solid #374151";
}

function getMedalBoxShadow(placement: ArenaPlacement): string {
  if (placement === 1) {
    return "0 4px 16px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 215, 0, 0.1)";
  }
  if (placement === 2) {
    return "0 4px 16px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(192, 192, 192, 0.1)";
  }
  if (placement === 3) {
    return "0 4px 16px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(205, 127, 50, 0.1)";
  }
  return "0 4px 16px rgba(0, 0, 0, 0.3)";
}

export function getTeamStyling(placement: ArenaPlacement, hasTracked: boolean) {
  const medalAccent = {
    border: getMedalBorder(placement),
    boxShadow: getMedalBoxShadow(placement),
  };

  if (hasTracked) {
    return {
      background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
      border: "3px solid #fbbf24",
      boxShadow:
        "0 8px 24px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(251, 191, 36, 0.3), 0 0 20px rgba(251, 191, 36, 0.15)",
    };
  }

  return {
    background: "linear-gradient(135deg, #111827 0%, #1f2937 100%)",
    border: medalAccent.border,
    boxShadow: medalAccent.boxShadow,
  };
}
