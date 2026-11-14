import { describe, expect, test } from "vitest";
import { createStreambotDashboard } from "./streambot-dashboard.ts";

describe("Streambot playback diagnostics dashboard", () => {
  const dashboard = createStreambotDashboard();
  const panels =
    dashboard.panels?.filter((panel) => panel.type !== "row") ?? [];

  test("retains rare sender excursions alongside histogram tails", () => {
    for (const name of [
      "streambot_send_interval_seconds",
      "streambot_source_idle_seconds",
      "streambot_send_lateness_seconds",
    ]) {
      expect(JSON.stringify(panels)).toContain(
        `histogram_quantile(0.999, sum by (kind, le) (rate(${name}_bucket[5m])))`,
      );
    }
    const excursions = panels.find(
      (panel) => panel.title === "Sender gaps and starvation > 200 ms / 5m",
    );
    expect(JSON.stringify(excursions)).toContain(
      "increase(streambot_send_gaps_total[5m])",
    );
    expect(JSON.stringify(excursions)).toContain(
      "increase(streambot_source_starvations_total[5m])",
    );
  });

  test("does not turn missing peer reports into healthy zero loss", () => {
    for (const title of [
      "Peer-reported video packet loss (p99)",
      "Peer-reported video jitter (p99)",
      "Latest peer receiver-report age",
    ]) {
      const panel = panels.find((candidate) => candidate.title === title);
      expect(panel).toBeDefined();
      expect(JSON.stringify(panel)).not.toContain("vector(0)");
    }
    expect(JSON.stringify(panels)).toContain(
      "time() - (streambot_video_receiver_last_report_timestamp_seconds > 0)",
    );
  });

  test("identifies the measurement boundary instead of claiming viewer delivery", () => {
    const sender = panels.find(
      (panel) => panel.title === "Sender frame intervals (p99 / p99.9)",
    );
    expect(
      sender && "description" in sender ? sender.description : undefined,
    ).toContain("submissions to the native transport");
    const peer = panels.find(
      (panel) => panel.title === "Peer-reported video packet loss (p99)",
    );
    expect(
      peer && "description" in peer ? peer.description : undefined,
    ).toContain("not every viewer");
    const nack = panels.find(
      (panel) => panel.title === "Video packets requested by NACK / s",
    );
    expect(
      nack && "description" in nack ? nack.description : undefined,
    ).toContain("including repeated requests");
  });

  test("places diagnostic panels below the existing voice summary without overlaps", () => {
    const diagnostics = panels.filter((panel) => (panel.gridPos?.y ?? 0) >= 67);
    expect(diagnostics).toHaveLength(13);
    for (const [index, panel] of diagnostics.entries()) {
      const a = panel.gridPos;
      expect(a).toBeDefined();
      if (a === undefined) continue;
      for (const other of diagnostics.slice(index + 1)) {
        const b = other.gridPos;
        expect(b).toBeDefined();
        if (b === undefined) continue;
        expect(
          a.x < b.x + b.w &&
            a.x + a.w > b.x &&
            a.y < b.y + b.h &&
            a.y + a.h > b.y,
        ).toBe(false);
      }
    }
  });
});
