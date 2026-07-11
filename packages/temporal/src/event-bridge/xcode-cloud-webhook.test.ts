import { describe, expect, it } from "bun:test";
import {
  type AlertPoster,
  type AlertmanagerAlert,
  buildXcodeCloudWebhookApp,
  createAlertmanagerPoster,
} from "./xcode-cloud-webhook.ts";
import {
  XcodeCloudPayloadSchema,
  classifyBuild,
  normalizeXcodeCloudPayload,
} from "./xcode-cloud-webhook-schema.ts";

const TOKEN = "s3cr3t-xcode-cloud-token-0123456789";
const NOW = new Date("2026-07-11T18:14:11.000Z");
const TTL_MS = 6 * 60 * 60 * 1000;

function fixturePath(name: string): URL {
  return new URL(`__fixtures__/xcode-cloud/${name}.json`, import.meta.url);
}

type FetchCall = { url: string; method: string; ct: string; body: string };

/** A `globalThis.fetch` stub that returns a canned Response and optionally records calls. */
function makeFetchStub(
  respond: () => Response,
  preconnect: typeof fetch.preconnect,
  record?: (call: FetchCall) => void,
): typeof fetch {
  const handler = (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const headers = new Headers(init?.headers);
    record?.({
      url,
      method: init?.method ?? "GET",
      ct: headers.get("content-type") ?? "",
      body: typeof init?.body === "string" ? init.body : "",
    });
    return Promise.resolve(respond());
  };
  return Object.assign(handler, { preconnect });
}

const rejectingPoster: AlertPoster = () =>
  Promise.reject(new Error("connection refused"));

async function loadFixtureText(name: string): Promise<string> {
  return Bun.file(fixturePath(name)).text();
}

type Captured = { alerts: AlertmanagerAlert[] };

function capturingPoster(): { poster: AlertPoster; calls: Captured[] } {
  const calls: Captured[] = [];
  const poster: AlertPoster = (alerts) => {
    calls.push({ alerts });
    return Promise.resolve();
  };
  return { poster, calls };
}

function makeApp(poster: AlertPoster) {
  return buildXcodeCloudWebhookApp(TOKEN, poster, {
    ttlMs: TTL_MS,
    now: () => NOW,
  });
}

async function postFixture(
  app: ReturnType<typeof buildXcodeCloudWebhookApp>,
  fixture: string,
  opts: { token?: string } = {},
): Promise<Response> {
  const body = await loadFixtureText(fixture);
  const token = opts.token ?? TOKEN;
  return app.fetch(
    new Request(`http://test/hook/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
  );
}

describe("xcode-cloud webhook auth", () => {
  it("rejects a wrong token", async () => {
    const { poster, calls } = capturingPoster();
    const res = await postFixture(makeApp(poster), "build-completed-failed", {
      token: "definitely-not-the-token",
    });
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("rejects a wrong-but-same-length token (timing-safe path)", async () => {
    const { poster, calls } = capturingPoster();
    const wrongSameLength = "x".repeat(TOKEN.length);
    expect(wrongSameLength.length).toBe(TOKEN.length);
    const res = await postFixture(makeApp(poster), "build-completed-failed", {
      token: wrongSameLength,
    });
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("accepts the correct token", async () => {
    const { poster } = capturingPoster();
    const res = await postFixture(makeApp(poster), "build-completed-failed");
    expect(res.status).toBe(200);
  });
});

describe("xcode-cloud webhook → Alertmanager translation", () => {
  it("fires an alert for a FAILED build", async () => {
    const { poster, calls } = capturingPoster();
    const res = await postFixture(makeApp(poster), "build-completed-failed");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("firing\n");
    expect(calls).toHaveLength(1);
    const alerts = calls[0]?.alerts ?? [];
    expect(alerts).toHaveLength(1);
    const alert = alerts[0];

    expect(alert?.labels).toEqual({
      alertname: "XcodeCloudBuildFailed",
      severity: "warning",
      service: "xcode-cloud",
      product: "Tasks for Obsidian",
      workflow: "Archive - iOS",
      branch: "main",
    });
    // dedup labels must NOT include the build number, else a later SUCCEEDED
    // (a different build number) could not resolve the firing alert.
    expect(alert?.labels).not.toHaveProperty("product", "88");
    expect(Object.keys(alert?.labels ?? {})).not.toContain("build");

    expect(alert?.annotations["summary"]).toBe(
      "Xcode Cloud build failed: Archive - iOS on main",
    );
    expect(alert?.annotations["message"]).toContain("build #87");
    expect(alert?.annotations["message"]).toContain("status FAILED");
    expect(alert?.annotations["message"]).toContain("commit a1b2c3d4e5f6");

    expect(alert?.startsAt).toBe(NOW.toISOString());
    expect(alert?.endsAt).toBe(new Date(NOW.getTime() + TTL_MS).toISOString());
    expect(alert?.generatorURL).toBe(
      "https://github.com/shepherdjerred/monorepo/commit/a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    );
  });

  it("fires an alert for an ERRORED build", async () => {
    const { poster, calls } = capturingPoster();
    const res = await postFixture(makeApp(poster), "build-completed-errored");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("firing\n");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.alerts[0]?.labels["severity"]).toBe("warning");
    expect(calls[0]?.alerts[0]?.annotations["message"]).toContain(
      "status ERRORED",
    );
  });

  it("resolves for a SUCCEEDED build with dedup labels matching the failure", async () => {
    const { poster, calls } = capturingPoster();
    const res = await postFixture(
      makeApp(poster),
      "build-completed-succeeded-flat",
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("resolved\n");
    expect(calls).toHaveLength(1);
    const alert = calls[0]?.alerts[0];

    // Same dedup labels as the FAILED alert → Alertmanager resolves that
    // fingerprint. (Proves the flat-shaped payload normalizes identically.)
    expect(alert?.labels).toEqual({
      alertname: "XcodeCloudBuildFailed",
      severity: "warning",
      service: "xcode-cloud",
      product: "Tasks for Obsidian",
      workflow: "Archive - iOS",
      branch: "main",
    });
    // resolved: endsAt == startsAt so Alertmanager marks it resolved now.
    expect(alert?.endsAt).toBe(alert?.startsAt);
    expect(alert?.startsAt).toBe(NOW.toISOString());
  });

  it("ignores a CANCELED build", async () => {
    const { poster, calls } = capturingPoster();
    const res = await postFixture(makeApp(poster), "build-completed-canceled");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ignored\n");
    expect(calls).toHaveLength(0);
  });

  it("ignores a non-terminal BUILD_STARTED event", async () => {
    const { poster, calls } = capturingPoster();
    const res = await postFixture(makeApp(poster), "build-started");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ignored\n");
    expect(calls).toHaveLength(0);
  });

  it("returns 400 on malformed JSON", async () => {
    const { poster, calls } = capturingPoster();
    const res = await makeApp(poster).fetch(
      new Request(`http://test/hook/${TOKEN}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      }),
    );
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("returns 400 on a non-object payload", async () => {
    const { poster, calls } = capturingPoster();
    const res = await makeApp(poster).fetch(
      new Request(`http://test/hook/${TOKEN}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "[1,2,3]",
      }),
    );
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("returns 500 when the Alertmanager POST fails", async () => {
    const res = await postFixture(
      makeApp(rejectingPoster),
      "build-completed-failed",
    );
    expect(res.status).toBe(500);
  });
});

describe("real Alertmanager poster wiring (fetch capture)", () => {
  it("POSTs the alert array to <base>/api/v2/alerts", async () => {
    const originalFetch = globalThis.fetch;
    const captured: FetchCall[] = [];
    globalThis.fetch = makeFetchStub(
      () => new Response(null, { status: 200 }),
      originalFetch.preconnect,
      (call) => captured.push(call),
    );

    try {
      const app = buildXcodeCloudWebhookApp(
        TOKEN,
        createAlertmanagerPoster("http://alertmanager.test:9093"),
        { ttlMs: TTL_MS, now: () => NOW },
      );
      const res = await postFixture(app, "build-completed-failed");
      expect(res.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }

    // Filter to Alertmanager calls: the full test suite has background
    // telemetry/Sentry fetches that would otherwise pollute a raw count.
    const amCalls = captured.filter(
      (c) => c.url === "http://alertmanager.test:9093/api/v2/alerts",
    );
    expect(amCalls).toHaveLength(1);
    const call = amCalls[0];
    expect(call?.method).toBe("POST");
    expect(call?.ct).toContain("application/json");

    const parsed: unknown = JSON.parse(call?.body ?? "[]");
    expect(Array.isArray(parsed)).toBe(true);
    if (Array.isArray(parsed)) {
      expect(parsed).toHaveLength(1);
    }
  });

  it("throws when Alertmanager returns a non-2xx status", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = makeFetchStub(
      () => new Response("nope", { status: 503 }),
      originalFetch.preconnect,
    );
    try {
      const poster = createAlertmanagerPoster("http://alertmanager.test:9093");
      await expect(
        poster([
          {
            labels: { alertname: "XcodeCloudBuildFailed", severity: "warning" },
            annotations: {},
            startsAt: NOW.toISOString(),
            endsAt: NOW.toISOString(),
          },
        ]),
      ).rejects.toThrow(/503/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("payload schema + classification (golden)", () => {
  const cases = [
    {
      fixture: "build-completed-failed",
      completionStatus: "FAILED",
      outcome: "firing",
      workflow: "Archive - iOS",
      branch: "main",
    },
    {
      fixture: "build-completed-errored",
      completionStatus: "ERRORED",
      outcome: "firing",
      workflow: "Archive - iOS",
      branch: "main",
    },
    {
      fixture: "build-completed-succeeded-flat",
      completionStatus: "SUCCEEDED",
      outcome: "resolved",
      workflow: "Archive - iOS",
      branch: "main",
    },
    {
      fixture: "build-completed-canceled",
      completionStatus: "CANCELED",
      outcome: "ignore",
      workflow: "Archive - iOS",
      branch: "main",
    },
    {
      fixture: "build-started",
      completionStatus: undefined,
      outcome: "ignore",
      workflow: "Archive - iOS",
      branch: "main",
    },
  ] as const;

  for (const c of cases) {
    it(`parses + classifies ${c.fixture}`, async () => {
      const raw: unknown = JSON.parse(await loadFixtureText(c.fixture));
      const payload = XcodeCloudPayloadSchema.parse(raw);
      const event = normalizeXcodeCloudPayload(payload);
      expect(event.completionStatus).toBe(c.completionStatus);
      expect(event.workflowName).toBe(c.workflow);
      expect(event.branch).toBe(c.branch);
      expect(classifyBuild(event)).toBe(c.outcome);
    });
  }
});
