import { describe, expect, test } from "vitest";
import { getStreambotRuleGroups } from "./streambot.ts";
import { runPromtoolFixture } from "./platform/promtool-fixture.ts";

const rules = getStreambotRuleGroups().flatMap((group) => group.rules ?? []);

function requireRule(alert: string) {
  const rule = rules.find((candidate) => candidate.alert === alert);
  if (rule === undefined) throw new Error(`Missing ${alert} rule`);
  return rule;
}

describe("Streambot pipeline alert activity matching", () => {
  test.each([
    {
      alert: "StreambotEncoderStalled",
      metric: 'streambot_ffmpeg_out_time_seconds_total{hardware="true"}',
      values: "0+0x12",
    },
    {
      alert: "StreambotEncoderProducerAhead",
      metric: 'streambot_ffmpeg_speed_ratio{hardware="true"}',
      values: "1.5+0x12",
    },
    {
      alert: "StreambotEncoderFallingBehind",
      metric: 'streambot_ffmpeg_speed_ratio{hardware="true"}',
      values: "0.5+0x12",
    },
    {
      alert: "StreambotProgressStalled",
      metric: "streambot_ffmpeg_progress_age_seconds{}",
      values: "10+0x12",
    },
    {
      alert: "StreambotPlaybackBehindSchedule",
      metric: 'streambot_playback_behind_seconds{kind="video"}',
      values: "2+0x12",
    },
  ])("$alert handles concurrent segments and idle telemetry", async (entry) => {
    const expression = requireRule(entry.alert).expr.value;
    if (typeof expression !== "string") {
      throw new TypeError(`Missing expression for ${entry.alert}`);
    }
    await runPromtoolFixture({
      evaluation_interval: "15s",
      tests: [2, 0].map((active) => ({
        interval: "15s",
        input_series: [
          {
            series: entry.metric
              .replace("{", '{namespace="media",pod="streambot-active",')
              .replace(",}", "}"),
            values: entry.values,
          },
          {
            series:
              'streambot_stream_active{namespace="media",pod="streambot-active"}',
            values: `${String(active)}+0x12`,
          },
        ],
        promql_expr_test: [
          {
            expr: `count(${expression})`,
            eval_time: "2m",
            exp_samples: active > 0 ? [{ labels: "{}", value: 1 }] : [],
          },
        ],
      })),
    });
  });
});

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
