import type { WebSnapshot } from "@shepherdjerred/streambot/web/shared/contracts.ts";

export type WebStationScope = "room" | "mine" | "server";
export type WebTvPreset =
  "my-mix" | "continue-series" | "sitcoms" | "movies" | "youtube";

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

export function tvPresetDisplayLabel(preset: WebTvPreset = "my-mix"): string {
  switch (preset) {
    case "continue-series":
      return "Continue Series";
    case "sitcoms":
      return "Sitcoms";
    case "movies":
      return "Movies";
    case "youtube":
      return "YouTube";
    case "my-mix":
      return "My Mix";
  }
}

export function formatStationBadge(
  station: NonNullable<WebSnapshot["station"]>,
): string {
  if (station.kind === "tv") {
    const base = "TV · " + tvPresetDisplayLabel(station.tvPreset);
    return station.seed === undefined ? base : base + " · " + station.seed;
  }
  return station.seed === undefined
    ? "RADIO · " + scopeDisplayLabel(station.scope)
    : "RADIO · " + station.seed;
}
