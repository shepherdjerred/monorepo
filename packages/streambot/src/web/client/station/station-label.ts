import type { WebSnapshot } from "@shepherdjerred/streambot/web/shared/contracts.ts";

export type WebStationScope = "room" | "mine" | "server";

export function scopeDisplayLabel(scope: WebStationScope): string {
  switch (scope) {
    case "mine":
      return "Mine";
    case "server":
      return "Server";
    case "room":
      return "Room";
  }
}

export function formatStationBadge(
  station: NonNullable<WebSnapshot["station"]>,
): string {
  if (station.kind === "tv") {
    return "TV · " + (station.tvPreset ?? "Mix");
  }
  return station.seed === undefined
    ? "RADIO · " + scopeDisplayLabel(station.scope)
    : "RADIO · " + station.seed;
}
