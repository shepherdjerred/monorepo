import { afterAll, describe, expect, test } from "bun:test";
import {
  register,
  startMetricsServer,
  stopMetricsServer,
} from "@shepherdjerred/streambot/observability/metrics.ts";

const TEST_PORT = 19_466;

afterAll(async () => {
  await stopMetricsServer();
});

describe("metrics registry", () => {
  test("registers the headline streambot series", async () => {
    const body = await register.metrics();
    expect(body).toContain("streambot_ffmpeg_speed_ratio");
    expect(body).toContain("streambot_send_frametime_ratio");
    expect(body).toContain("streambot_hw_decode_engaged");
    expect(body).toContain("streambot_source_info");
  });
});

describe("startMetricsServer", () => {
  test("port 0 disables the server", () => {
    expect(startMetricsServer(0)).toBeUndefined();
  });

  test("serves /metrics and /healthz, then stops", async () => {
    expect(startMetricsServer(TEST_PORT)).toBe(TEST_PORT);
    const base = `http://localhost:${String(TEST_PORT)}`;

    const metricsRes = await fetch(`${base}/metrics`);
    expect(metricsRes.status).toBe(200);
    expect(await metricsRes.text()).toContain("streambot_");

    const healthRes = await fetch(`${base}/healthz`);
    expect(healthRes.status).toBe(200);

    const missingRes = await fetch(`${base}/nope`);
    expect(missingRes.status).toBe(404);

    await stopMetricsServer();
  });
});
