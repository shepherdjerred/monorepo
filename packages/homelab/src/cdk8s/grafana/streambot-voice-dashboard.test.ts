import { describe, expect, test } from "bun:test";
import { createStreambotDashboard } from "./streambot-dashboard.ts";
import { createStreambotVoiceDashboard } from "./streambot-voice-dashboard.ts";

describe("Streambot Voice dashboard", () => {
  const dashboard = JSON.stringify(createStreambotVoiceDashboard());

  test("covers every voice diagnostic layer", () => {
    for (const title of [
      "Readiness and ingress",
      "Activation funnel",
      "Quality and latency",
      "Cloud, tools, and usage",
      "Output and ducking",
      "Capture health and correlation",
    ]) {
      expect(dashboard).toContain(title);
    }
  });

  test("links correlated log trace and capture IDs to Tempo and Loki", () => {
    expect(dashboard).toContain("Trace in Tempo");
    expect(dashboard).toContain("Capture in Loki");
    expect(decodeURIComponent(dashboard)).toContain(
      "${__data.fields.trace_id}",
    );
    expect(decodeURIComponent(dashboard)).toContain(
      "${__data.fields.captureId}",
    );
  });

  test("keeps inactivity diagnostic rather than failure-shaped", () => {
    expect(dashboard).toContain("Quiet channels are diagnostic only");
    expect(dashboard).not.toContain("VoiceIngressInactive");
    expect(dashboard).toContain(
      "time() - (streambot_voice_last_packet_timestamp_seconds > 0)",
    );
    expect(dashboard).toContain(
      "time() - (streambot_voice_last_decoded_timestamp_seconds > 0)",
    );
  });

  test("main summary requires receive and DAVE readiness and filters zero ingress", () => {
    const mainDashboard = JSON.stringify(createStreambotDashboard());
    expect(mainDashboard).toContain(
      "streambot_voice_receive_ready * on(guild_id, channel_id) streambot_voice_dave_ready",
    );
    expect(mainDashboard).toContain(
      "time() - (streambot_voice_last_packet_timestamp_seconds > 0)",
    );
  });
});
