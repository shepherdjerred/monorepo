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
      companion: {
        metric: 'streambot_ffmpeg_speed_ratio{hardware="true"}',
        values: "0+0x12",
      },
    },
    {
      alert: "StreambotEncoderProducerAhead",
      metric: 'streambot_ffmpeg_speed_ratio{hardware="true"}',
      values: "1.5+0x12",
      companion: undefined,
    },
    {
      alert: "StreambotEncoderFallingBehind",
      metric: 'streambot_ffmpeg_speed_ratio{hardware="true"}',
      values: "0.5+0x12",
      companion: undefined,
    },
    {
      alert: "StreambotProgressStalled",
      metric: "streambot_ffmpeg_progress_age_seconds{}",
      values: "10+0x12",
      companion: undefined,
    },
    {
      alert: "StreambotPlaybackBehindSchedule",
      metric: 'streambot_playback_behind_seconds{kind="video"}',
      values: "2+0x12",
      companion: undefined,
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
          ...(entry.companion === undefined
            ? []
            : [
                {
                  series: entry.companion.metric
                    .replace("{", '{namespace="media",pod="streambot-active",')
                    .replace(",}", "}"),
                  values: entry.companion.values,
                },
              ]),
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

  test("ignores dormant hardware counters during audio-only playback and suppresses ProducerAhead on live streams", async () => {
    const stalledExpr = requireRule("StreambotEncoderStalled").expr.value;
    const aheadExpr = requireRule("StreambotEncoderProducerAhead").expr.value;
    expect(requireRule("StreambotEncoderFallingBehind").for).toBe("2m");
    expect(requireRule("StreambotPlaybackBehindSchedule").for).toBe("1m");
    expect(requireRule("StreambotExternalBufferHeavy").for).toBe("5m");

    await runPromtoolFixture({
      evaluation_interval: "15s",
      tests: [
        {
          interval: "15s",
          input_series: [
            {
              series:
                'streambot_ffmpeg_out_time_seconds_total{namespace="media",pod="streambot-active",hardware="true"}',
              values: "3600+0x12",
            },
            {
              series:
                'streambot_ffmpeg_out_time_seconds_total{namespace="media",pod="streambot-active",hardware="false"}',
              values: "0+15x12",
            },
            {
              series:
                'streambot_ffmpeg_speed_ratio{namespace="media",pod="streambot-active",hardware="false"}',
              values: "1+0x12",
            },
            {
              series:
                'streambot_stream_active{namespace="media",pod="streambot-active"}',
              values: "1+0x12",
            },
          ],
          promql_expr_test: [
            { expr: stalledExpr, eval_time: "2m", exp_samples: [] },
          ],
        },
        {
          interval: "15s",
          input_series: [
            {
              series:
                'streambot_ffmpeg_speed_ratio{namespace="media",pod="streambot-active",hardware="true"}',
              values: "1.5+0x12",
            },
            {
              series:
                'streambot_stream_active{namespace="media",pod="streambot-active"}',
              values: "1+0x12",
            },
            {
              series:
                'streambot_stream_live{namespace="media",pod="streambot-active",hardware="true"}',
              values: "1+0x12",
            },
          ],
          promql_expr_test: [
            { expr: aheadExpr, eval_time: "2m", exp_samples: [] },
          ],
        },
      ],
    });
  });
});

describe("Streambot memory and queue alerts", () => {
  test("StreambotExternalBufferHeavy requires >50% external/heap ratio, >256 MiB external memory, and an active stream", async () => {
    const rule = requireRule("StreambotExternalBufferHeavy");
    expect(rule.for).toBe("5m");
    expect(rule.annotations?.["description"]).toContain("256 MiB");
    const mib = 1024 * 1024;
    const memorySeries = (
      externalMiB: number,
      heapMiB: number,
      active: number,
    ): Series[] => [
      {
        series:
          'streambot_nodejs_external_memory_bytes{namespace="media",pod="streambot-active"}',
        values: `${String(externalMiB * mib)}+0x10`,
      },
      {
        series:
          'streambot_nodejs_heap_size_used_bytes{namespace="media",pod="streambot-active"}',
        values: `${String(heapMiB * mib)}+0x10`,
      },
      {
        series:
          'streambot_stream_active{namespace="media",pod="streambot-active"}',
        values: `${String(active)}+0x10`,
      },
    ];

    await runPromtoolFixture({
      evaluation_interval: "1m",
      tests: [
        // Active stream with 300 MiB external and 400 MiB heap (0.75 > 0.5): fires.
        firing(
          "StreambotExternalBufferHeavy",
          memorySeries(300, 400, 1),
          "5m",
          true,
        ),
        // Idle GC heap shrinkage (~31 MiB pooled Buffers vs ~60 MiB heap): does not fire.
        firing(
          "StreambotExternalBufferHeavy",
          memorySeries(31, 60, 0),
          "5m",
          false,
        ),
        // Active stream with high ratio (0.64) but <= 256 MiB external memory: does not fire.
        firing(
          "StreambotExternalBufferHeavy",
          memorySeries(64, 100, 1),
          "5m",
          false,
        ),
        // > 256 MiB external and > 0.5 ratio while no stream is active: does not fire.
        firing(
          "StreambotExternalBufferHeavy",
          memorySeries(300, 400, 0),
          "5m",
          false,
        ),
        // Active stream with > 256 MiB external but healthy ratio (300 / 700 = 0.43): does not fire.
        firing(
          "StreambotExternalBufferHeavy",
          memorySeries(300, 700, 1),
          "5m",
          false,
        ),
      ],
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

function expressionOf(alert: string): string {
  const expression = requireRule(alert).expr.value;
  if (typeof expression !== "string") {
    throw new TypeError(`Missing expression for ${alert}`);
  }
  return expression;
}

type Series = { series: string; values: string };

/** One promtool case: does the alert expression select anything at `evalTime`. */
function firing(
  alert: string,
  series: readonly Series[],
  evalTime: string,
  fires: boolean,
) {
  return {
    interval: "1m",
    input_series: series,
    promql_expr_test: [
      {
        expr: `count(${expressionOf(alert)})`,
        eval_time: evalTime,
        exp_samples: fires ? [{ labels: "{}", value: 1 }] : [],
      },
    ],
  };
}

const providerCalls = (
  outcome: string,
  values: string,
  operation = "search_song",
): Series => ({
  series: `streambot_music_provider_requests_total{namespace="media",provider="youtube-music",operation="${operation}",outcome="${outcome}"}`,
  values,
});

const requests = (labels: string, values: string): Series => ({
  series: `streambot_web_requests_total{namespace="media",route="/api/room",${labels}}`,
  values,
});

describe("Streambot web remote alerts", () => {
  test("StreambotWebServerErrors needs both a 5% ratio and 50 requests", async () => {
    expect(requireRule("StreambotWebServerErrors").for).toBe("5m");
    const ok = requests('status_class="2xx",code="ok"', "0+10x30");
    await runPromtoolFixture({
      evaluation_interval: "1m",
      tests: [
        // One failure per minute against ten successes: 9% of 165 requests.
        firing(
          "StreambotWebServerErrors",
          [ok, requests('status_class="5xx",code="other"', "0+1x30")],
          "20m",
          true,
        ),
        // `unavailable` failures count even when the status class is not 5xx.
        firing(
          "StreambotWebServerErrors",
          [ok, requests('status_class="4xx",code="unavailable"', "0+1x30")],
          "20m",
          true,
        ),
        // One failed request out of three, inside the evaluation window, is 33% but far below the volume floor.
        firing(
          "StreambotWebServerErrors",
          [
            requests('status_class="2xx",code="ok"', "0x7 1 2 2x22"),
            requests('status_class="5xx",code="other"', "0x7 0 1 1x22"),
          ],
          "20m",
          false,
        ),
        // Healthy volume with a failure rate under 5%.
        firing(
          "StreambotWebServerErrors",
          [ok, requests('status_class="5xx",code="other"', "0+0.2x30")],
          "20m",
          false,
        ),
        // Client aborts neither count as failures nor dilute the denominator.
        firing(
          "StreambotWebServerErrors",
          [
            ok,
            requests('status_class="aborted",code="client_aborted"', "0+5x30"),
          ],
          "20m",
          false,
        ),
      ],
    });
  });

  test("StreambotWebTimeToPlaybackSlow needs a slow p95 and ten starts per transport", async () => {
    expect(requireRule("StreambotWebTimeToPlaybackSlow").for).toBe("10m");
    const metric = "streambot_web_time_to_playback_seconds";
    const histogram = (
      transport: string,
      slow: string,
      fast: string,
    ): Series[] => {
      const labels = `namespace="media",transport="${transport}"`;
      return [
        { series: `${metric}_bucket{${labels},le="20"}`, values: fast },
        { series: `${metric}_bucket{${labels},le="30"}`, values: slow },
        { series: `${metric}_bucket{${labels},le="+Inf"}`, values: slow },
        { series: `${metric}_count{${labels}}`, values: slow },
      ];
    };
    await runPromtoolFixture({
      evaluation_interval: "1m",
      tests: [
        // 40 starts, every one between 20 and 30 seconds.
        firing(
          "StreambotWebTimeToPlaybackSlow",
          histogram("watch", "0+1x40", "0+0x40"),
          "35m",
          true,
        ),
        // Three slow starts are not enough volume.
        firing(
          "StreambotWebTimeToPlaybackSlow",
          histogram("listen", "0x7 3 3x32", "0+0x40"),
          "35m",
          false,
        ),
        // Fast starts: every observation lands in the 20 second bucket.
        firing(
          "StreambotWebTimeToPlaybackSlow",
          histogram("watch", "0+1x40", "0+1x40"),
          "35m",
          false,
        ),
      ],
    });
  });

  test("StreambotMusicSearchProviderFailing needs a majority of failed calls and 20 calls", async () => {
    expect(requireRule("StreambotMusicSearchProviderFailing").for).toBe("10m");
    const calls = providerCalls;
    const alert = "StreambotMusicSearchProviderFailing";
    await runPromtoolFixture({
      evaluation_interval: "1m",
      tests: [
        firing(
          alert,
          [calls("error", "0+1x40"), calls("ok", "0+0x40")],
          "35m",
          true,
        ),
        firing(
          alert,
          [calls("unavailable", "0+1x40"), calls("ok", "0+0x40")],
          "35m",
          true,
        ),
        // One failed call on a quiet evening.
        firing(
          alert,
          [calls("error", "0x7 0 1 1x32"), calls("ok", "0+0x40")],
          "35m",
          false,
        ),
        // High volume with mostly healthy calls.
        firing(
          alert,
          [calls("error", "0+0.2x40"), calls("ok", "0+2x40")],
          "35m",
          false,
        ),
        // Calls cancelled by the viewer leaving are aborts, not provider failures.
        firing(
          alert,
          [calls("aborted", "0+1x40"), calls("ok", "0+0.5x40")],
          "35m",
          false,
        ),
        // Parser drift is counted elsewhere and never feeds this ratio.
        firing(
          alert,
          [calls("error", "0+1x40", "parser"), calls("ok", "0+0x40")],
          "35m",
          false,
        ),
      ],
    });
  });
});
