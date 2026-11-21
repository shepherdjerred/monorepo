import { describe, expect, test } from "vitest";
import { createStreambotWebDashboard } from "./streambot-web-dashboard.ts";

describe("Streambot web remote dashboard", () => {
  const model = createStreambotWebDashboard();
  const panels = model.panels?.filter((panel) => panel.type !== "row") ?? [];
  const json = JSON.stringify(model);

  test("has a stable uid and one panel per diagnostic question", () => {
    expect(model.uid).toBe("streambot-web");
    const titles = panels.map((panel) => panel.title);
    for (const title of [
      "Request rate by code",
      "Error rate by code",
      "Request duration p50 / p95 by route",
      "Command outcomes by action",
      "Command outcomes by transport",
      "Command duration p50 / p95 by action",
      "Time to playback p50 / p95 by transport",
      "Play success ratio by surface",
      "Sign-ins by outcome",
      "Open SSE connections",
      "SSE events by name",
      "SSE drops and closes by reason",
      "Search rate by kind and provider",
      "Search outcomes",
      "Search latency p50 / p95 by kind and provider",
      "Music provider requests by outcome",
      "Analytics capture outcomes",
    ]) {
      expect(titles).toContain(title);
    }
  });

  test("queries the exact metric names the application registers", () => {
    for (const metric of [
      "streambot_web_requests_total",
      "streambot_web_request_duration_seconds_bucket",
      "streambot_web_commands_total",
      "streambot_web_command_duration_seconds_bucket",
      "streambot_web_time_to_playback_seconds_bucket",
      "streambot_play_requests_total",
      "streambot_web_logins_total",
      "streambot_web_sse_connections",
      "streambot_web_sse_events_total",
      "streambot_web_sse_dropped_total",
      "streambot_web_sse_closed_total",
      "streambot_web_sse_connection_seconds_bucket",
      "streambot_web_search_total",
      "streambot_web_search_duration_seconds_bucket",
      "streambot_music_provider_requests_total",
      "streambot_analytics_events_total",
    ]) {
      expect(json).toContain(metric);
    }
  });

  test("never groups or legends by an identifying label", () => {
    const queries = JSON.stringify(
      panels.flatMap((panel) =>
        "targets" in panel
          ? (panel.targets ?? []).map((target: object) => [
              Reflect.get(target, "expr"),
              Reflect.get(target, "legendFormat"),
            ])
          : [],
      ),
    );
    expect(queries).toContain("streambot_");
    for (const label of ["guild", "channel", "user", "query", "title", "url"]) {
      expect(queries).not.toContain(label);
    }
  });

  test("lays panels out without overlap", () => {
    const cells = new Set<string>();
    for (const panel of panels) {
      const pos = panel.gridPos;
      if (pos === undefined)
        throw new Error(`No gridPos for ${panel.title ?? "a panel"}`);
      for (let x = pos.x; x < pos.x + pos.w; x += 1) {
        for (let y = pos.y; y < pos.y + pos.h; y += 1) {
          const cell = `${x.toString()},${y.toString()}`;
          expect(cells.has(cell)).toBe(false);
          cells.add(cell);
        }
      }
    }
  });
});
