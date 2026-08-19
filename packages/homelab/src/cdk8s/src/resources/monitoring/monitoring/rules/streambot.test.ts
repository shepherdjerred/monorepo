import { describe, expect, test } from "bun:test";
import { getStreambotRuleGroups } from "./streambot.ts";

const rules = getStreambotRuleGroups().flatMap((group) => group.rules ?? []);

function requireRule(alert: string) {
  const rule = rules.find((candidate) => candidate.alert === alert);
  if (rule === undefined) throw new Error(`Missing ${alert} rule`);
  return rule;
}

describe("Streambot voice alerts", () => {
  test("warns only when an active receive path stays unready", () => {
    const rule = requireRule("StreambotVoiceReceiveUnready");
    expect(rule.for).toBe("2m");
    expect(rule.labels?.["severity"]).toBe("warning");
    const expression = JSON.stringify(rule.expr);
    expect(expression).toContain("streambot_voice_receive_ready");
    expect(expression).toContain("streambot_voice_dave_ready");
    expect(expression).toContain("streambot_voice_sessions_active");
  });

  test("requires both a five-percent error ratio and 100 packets", () => {
    const expression = JSON.stringify(
      requireRule("StreambotVoiceIngressErrorsHigh").expr,
    );
    expect(expression).toContain("decrypt-error");
    expect(expression).toContain("malformed");
    expect(expression).toContain("streambot_voice_decode_errors_total");
    expect(expression).toContain("> 0.05");
    expect(expression).toContain(">= 100");
  });

  test("notifies on quota, repeated cloud errors, and reply failures", () => {
    expect(
      JSON.stringify(requireRule("StreambotVoiceQuotaExhausted").expr),
    ).toContain(String.raw`outcome=\"quota\"`);
    expect(
      JSON.stringify(requireRule("StreambotVoiceOpenAiFailures").expr),
    ).toContain(">= 3");
    expect(
      JSON.stringify(requireRule("StreambotVoiceReplyDeliveryFailure").expr),
    ).toContain("streambot_voice_reply_send_failures_total");
  });

  test("notifies on capture loss and sustained queue pressure", () => {
    expect(
      JSON.stringify(requireRule("StreambotVoiceCaptureFailures").expr),
    ).toContain("streambot_voice_capture_drops_total");
    const pressure = requireRule("StreambotVoiceCaptureQueuePressure");
    expect(pressure.for).toBe("5m");
    expect(JSON.stringify(pressure.expr)).toContain("100 * 1024 * 1024");
  });

  test("warns for stuck turns and critically alerts on orphaned ducking", () => {
    expect(
      JSON.stringify(requireRule("StreambotVoiceTurnStuck").expr),
    ).toContain("> 35");
    const duck = requireRule("StreambotVoicePlaybackDuckStuck");
    expect(duck.for).toBe("60s");
    expect(duck.labels?.["severity"]).toBe("critical");
    expect(JSON.stringify(duck.expr)).toContain(
      "streambot_voice_turn_age_seconds",
    );
  });

  test("does not turn quiet ingress into an alert", () => {
    const serialized = JSON.stringify(rules);
    expect(serialized).not.toContain("VoiceIngressInactive");
    expect(serialized).not.toContain("last_packet_timestamp_seconds >");
  });
});
