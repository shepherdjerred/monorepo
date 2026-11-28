import { describe, expect, it } from "vitest";
import {
  IncidentDetailSchema,
  IncidentSignalBatchResultSchema,
  IncidentStreamFrameSchema,
} from "#shared/contract.ts";
import { hasBearer } from "#server/bearer.ts";
import { createIncidentsHubServer } from "#server/hub-server.ts";
import { createInMemoryIncidentsRepository } from "#infrastructure/in-memory-repository.ts";
import { staticIncidentsFlags } from "#infrastructure/flags.ts";
import { Hono } from "hono";
import {
  AGENT,
  createHarness,
  OPS_TOKEN,
  statusOf,
  WEBHOOK_TOKEN,
} from "#testing/hub.ts";
import { minutes, T0 } from "#testing/records.ts";

const RED_MAIN = {
  source: "main-ci",
  key: "main-ci:main",
  firing: true,
  system: "main-ci",
  severity: "sev2",
  title: "main is red: pipeline #19256",
  exitCondition: "The next main pipeline passes.",
  observedAt: T0.toISOString(),
  suspect: {
    commitSha: "c39e98ac531c",
    prNumber: 5142,
    sessionId: "session_01X",
  },
};

function webhook(
  status: "firing" | "resolved",
  alertname = "DeliveryRecoveryRequired",
) {
  return {
    version: "4",
    groupKey: "{}:{}",
    truncatedAlerts: 0,
    status,
    receiver: "incidents",
    groupLabels: {},
    commonLabels: {},
    commonAnnotations: {},
    externalURL: "http://alertmanager:9093",
    alerts: [
      {
        status,
        labels: { alertname },
        annotations: { summary: "temporal-workers requires recovery" },
        startsAt: T0.toISOString(),
        endsAt:
          status === "firing"
            ? "0001-01-01T00:00:00Z"
            : minutes(30).toISOString(),
        generatorURL: "http://prometheus:9090/graph",
        fingerprint: "fp-delivery",
      },
    ],
  };
}

function post(app: Hono, path: string, body: unknown, token?: string) {
  return app.request(`/api/incidents${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("bearer", () => {
  it("accepts only the exact token", () => {
    expect(hasBearer("Bearer secret", "secret")).toBe(true);
    expect(hasBearer("Bearer secre", "secret")).toBe(false);
    expect(hasBearer("secret", "secret")).toBe(false);
    expect(hasBearer(undefined, "secret")).toBe(false);
  });
});

describe("POST /alertmanager", () => {
  it("authenticates, validates, and opens then auto-resolves the curated incident", async () => {
    const h = createHarness();
    expect(
      await statusOf(post(h.app, "/alertmanager", webhook("firing"))),
    ).toBe(401);
    expect(
      await statusOf(post(h.app, "/alertmanager", webhook("firing"), "wrong")),
    ).toBe(401);
    expect(
      await statusOf(post(h.app, "/alertmanager", "{not json", WEBHOOK_TOKEN)),
    ).toBe(400);
    expect(
      await statusOf(
        post(h.app, "/alertmanager", { version: "3" }, WEBHOOK_TOKEN),
      ),
    ).toBe(400);

    const fired = await post(
      h.app,
      "/alertmanager",
      webhook("firing"),
      WEBHOOK_TOKEN,
    );
    expect(fired.status).toBe(202);
    expect(
      IncidentSignalBatchResultSchema.parse(await fired.json()).results,
    ).toEqual([{ key: "fp-delivery", outcome: "opened", identifier: "INC-1" }]);
    const repeat = await post(
      h.app,
      "/alertmanager",
      webhook("firing"),
      WEBHOOK_TOKEN,
    );
    expect(await repeat.json()).toMatchObject({
      results: [{ outcome: "ignored", identifier: "INC-1" }],
      uncurated: 0,
    });

    const incident = await h.server.service.byRef("INC-1");
    expect(incident).toMatchObject({
      severity: "sev1",
      systems: ["delivery"],
      source: "alertmanager",
      firingSignals: 1,
    });

    h.clock.now = minutes(30);
    const cleared = await post(
      h.app,
      "/alertmanager",
      webhook("resolved"),
      WEBHOOK_TOKEN,
    );
    expect(await cleared.json()).toMatchObject({
      results: [{ outcome: "auto-resolved", identifier: "INC-1" }],
    });
    const resolved = await h.server.service.byRef("INC-1");
    expect(resolved.status).toBe("resolved");
  });

  it("counts uncurated alerts without opening anything", async () => {
    const h = createHarness();
    const response = await post(
      h.app,
      "/alertmanager",
      webhook("firing", "KubePodCrashLooping"),
      WEBHOOK_TOKEN,
    );
    expect(await response.json()).toEqual({ results: [], uncurated: 1 });
  });

  it("answers 503 when no token is configured", async () => {
    const server = createIncidentsHubServer({
      repository: createInMemoryIncidentsRepository(),
      flags: staticIncidentsFlags(),
    });
    const app = new Hono();
    server.register(app);
    const response = await app.request("/alertmanager", {
      method: "POST",
      body: "{}",
    });
    expect(response.status).toBe(503);
  });
});

describe("POST /internal/signals", () => {
  it("opens a main-ci incident, keeps the commander informed, and never auto-resolves a claimed one", async () => {
    const h = createHarness();
    expect(
      await statusOf(
        post(
          h.app,
          "/internal/signals",
          { signals: [RED_MAIN] },
          WEBHOOK_TOKEN,
        ),
      ),
    ).toBe(401);
    expect(
      await statusOf(
        post(h.app, "/internal/signals", { signals: [] }, OPS_TOKEN),
      ),
    ).toBe(400);
    const opened = await post(
      h.app,
      "/internal/signals",
      { signals: [RED_MAIN] },
      OPS_TOKEN,
    );
    expect(opened.status).toBe(202);
    expect(await opened.json()).toEqual({
      results: [
        { key: "main-ci:main", outcome: "opened", identifier: "INC-1" },
      ],
    });

    const suspect = { ...AGENT, metadata: { sessionLink: "session_01X" } };
    const taken = await h.server.service.take({
      actor: suspect,
      ref: "INC-1",
      dispatch: false,
      force: false,
    });
    expect(taken.outcome).toBe("owned");

    h.clock.now = minutes(20);
    const green = await post(
      h.app,
      "/internal/signals",
      {
        signals: [
          { ...RED_MAIN, firing: false, observedAt: minutes(20).toISOString() },
        ],
      },
      OPS_TOKEN,
    );
    expect(await green.json()).toEqual({
      results: [
        { key: "main-ci:main", outcome: "cleared", identifier: "INC-1" },
      ],
    });
    const detail = await h.server.service.byRef("INC-1");
    expect(detail.status).toBe("investigating");
    expect(detail.timeline.at(-1)).toMatchObject({
      type: "signal-cleared",
      actor: null,
    });
  });
});

async function readUntil(
  reader: Pick<ReadableStreamDefaultReader, "read">,
  done: (text: string) => boolean,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + 2000;
  while (!done(text)) {
    if (Date.now() > deadline)
      throw new Error(`stream timed out with: ${text}`);
    const chunk = await reader.read();
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text;
}

function frames(text: string) {
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => IncidentStreamFrameSchema.parse(JSON.parse(line.slice(6))));
}

describe("GET /events/stream", () => {
  it("streams one frame per commit, filtered by incident, with heartbeats", async () => {
    const h = createHarness();
    await h.call(
      "declare",
      {
        actor: AGENT,
        title: "Tracker down",
        systems: ["tracker"],
        exitCondition: "Tracker answers.",
      },
      IncidentDetailSchema,
    );
    const all = await h.app.request("/api/incidents/events/stream");
    const one = await h.app.request(
      "/api/incidents/events/stream?incident=inc-2",
    );
    expect(all.headers.get("content-type")).toContain("text/event-stream");
    const allReader = all.body!.getReader();
    const oneReader = one.body!.getReader();
    await readUntil(allReader, (text) => text.includes(": connected"));
    await readUntil(oneReader, (text) => text.includes(": connected"));

    await h.call("join", { actor: AGENT, ref: "INC-1" }, IncidentDetailSchema);
    await h.call(
      "declare",
      {
        actor: AGENT,
        title: "Delivery stuck",
        systems: ["delivery"],
        exitCondition: "Dispatch resumes.",
      },
      IncidentDetailSchema,
    );

    const allText = await readUntil(
      allReader,
      (text) => frames(text).length >= 2,
    );
    expect(
      frames(allText).map((frame) => [
        frame.identifier,
        frame.type,
        frame.revision,
      ]),
    ).toEqual([
      ["INC-1", "joined", 1],
      ["INC-2", "declared", 0],
    ]);
    expect(allText).toContain("event: incident");
    const oneText = await readUntil(
      oneReader,
      (text) => frames(text).length > 0 && text.includes(": heartbeat"),
    );
    expect(frames(oneText).map((frame) => frame.identifier)).toEqual(["INC-2"]);
    await allReader.cancel();
    await oneReader.cancel();
  });

  it("rejects a bad filter and answers 404 while incidents are disabled", async () => {
    const h = createHarness();
    expect(
      await statusOf(
        h.app.request("/api/incidents/events/stream?incident=nope"),
      ),
    ).toBe(400);
    h.settings.current = { enabled: false };
    expect(await statusOf(h.app.request("/api/incidents/events/stream"))).toBe(
      404,
    );
  });
});
