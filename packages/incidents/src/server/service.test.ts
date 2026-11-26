import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ActorInputSchema,
  CheckIncidentsResultSchema,
  DuplicateIncidentSchema,
  IncidentDetailSchema,
  IncidentSummarySchema,
  StaleRevisionSchema,
  TakeCommandResultSchema,
} from "#shared/contract.ts";
import { createIncidentsFixtureHubServer } from "#server/hub-server.ts";
import {
  AGENT,
  agent,
  createHarness,
  jsonOf,
  OPS_TOKEN,
  requestDispatchLease,
} from "#testing/hub.ts";
import {
  PRIORITY_SCENARIO_EXPECTED,
  runPriorityScenario,
  runWatermarkRace,
  runWatermarkScenario,
  WATERMARK_RACE_EXPECTED,
  WATERMARK_SCENARIO_EXPECTED,
} from "#testing/signal-scenarios.ts";
import { minutes } from "#testing/records.ts";

const DECLARE = {
  actor: AGENT,
  title: "Delivery dispatch is stuck",
  severity: "sev1",
  systems: ["delivery"],
  exitCondition: "Queued deployments dispatch again.",
};

describe("declare and dedupe", () => {
  it("declares INC-1 with a Hub URL and a declared timeline event", async () => {
    const h = createHarness();
    const detail = await h.call("declare", DECLARE, IncidentDetailSchema);
    expect(detail).toMatchObject({
      identifier: "INC-1",
      status: "investigating",
      revision: 0,
      url: "https://hub.example.ts.net/incidents/INC-1",
      creator: { key: AGENT.key },
      command: { state: "none", takeoverEligibleAt: minutes(10).toISOString() },
    });
    expect(detail.timeline.map((event) => event.type)).toEqual(["declared"]);
  });

  it("answers CONFLICT with the existing incident for an overlapping system", async () => {
    const h = createHarness();
    await h.call("declare", DECLARE, IncidentDetailSchema);
    const error = await h.fail("declare", {
      ...DECLARE,
      actor: agent("b"),
      systems: ["delivery", "argocd"],
    });
    expect(error.data.code).toBe("CONFLICT");
    const duplicate = DuplicateIncidentSchema.parse(error.data.incident);
    expect(duplicate.existing.identifier).toBe("INC-1");
    expect(duplicate.systems).toEqual(["delivery"]);
    await h.call(
      "declare",
      { ...DECLARE, kind: "maintenance", title: "Delivery upgrade" },
      IncidentDetailSchema,
    );
  });

  it("refuses a stale expectedRevision with the current incident", async () => {
    const h = createHarness();
    const detail = await h.call("declare", DECLARE, IncidentDetailSchema);
    await h.call(
      "postUpdate",
      { actor: AGENT, ref: "INC-1", expectedRevision: 0, body: "Looking" },
      IncidentDetailSchema,
    );
    const error = await h.fail("postUpdate", {
      actor: AGENT,
      ref: detail.id,
      expectedRevision: 0,
      body: "Again",
    });
    expect(error.data.code).toBe("CONFLICT");
    expect(StaleRevisionSchema.parse(error.data.incident)).toMatchObject({
      expectedRevision: 0,
      incident: { revision: 1 },
    });
  });

  it("maps unknown refs and refused commands to tRPC codes", async () => {
    const h = createHarness();
    expect(await h.failCode("join", { actor: AGENT, ref: "INC-9" })).toBe(
      "NOT_FOUND",
    );
    expect(await h.failCode("join", { actor: AGENT, ref: "nope" })).toBe(
      "BAD_REQUEST",
    );
    await h.call("declare", DECLARE, IncidentDetailSchema);
    const resolve = await h.fail("resolve", {
      actor: agent("b"),
      ref: "INC-1",
      expectedRevision: 0,
      note: "done",
    });
    expect(resolve.data.code).toBe("FORBIDDEN");
    const handoff = await h.fail("handoff", {
      actor: AGENT,
      ref: "INC-1",
      expectedRevision: 0,
      to: "agent:unknown",
    });
    expect(handoff.data.code).toBe("NOT_FOUND");
  });
});

describe("command", () => {
  it("lets exactly one of many concurrent takers win", async () => {
    const h = createHarness();
    await h.call("declare", DECLARE, IncidentDetailSchema);
    h.clock.now = minutes(11);
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        h.call(
          "take",
          { actor: agent(`taker-${String(index)}`), ref: "INC-1" },
          TakeCommandResultSchema,
        ),
      ),
    );
    expect(results.filter((result) => result.outcome === "owned")).toHaveLength(
      1,
    );
    expect(
      results
        .filter((result) => result.outcome === "taken")
        .every(
          (result) =>
            result.outcome === "taken" && result.reason === "owned-by-other",
        ),
    ).toBe(true);
    const detail = await h.query(
      "byRef",
      { ref: "INC-1" },
      IncidentDetailSchema,
    );
    expect(
      detail.timeline.filter((event) => event.type === "claimed"),
    ).toHaveLength(1);
  });

  it("runs the dispatch protocol: lease, redeem, and lazy lapse", async () => {
    const h = createHarness({ settings: { takeoverProvider: "codex" } });
    await h.call("declare", DECLARE, IncidentDetailSchema);
    h.clock.now = minutes(11);
    const lease = await requestDispatchLease(h);
    expect(lease).toMatchObject({
      provider: "codex",
      leaseExpiresAt: minutes(21).toISOString(),
    });
    expect(lease.incident.command.dispatcher?.key).toBe("claude-code:waiter");

    h.clock.now = minutes(25);
    const lapsed = await h.query(
      "byRef",
      { ref: "INC-1" },
      IncidentDetailSchema,
    );
    expect(lapsed.command).toMatchObject({ state: "none", dispatcher: null });
    expect(lapsed.revision).toBe(lease.incident.revision);
    const late = await h.fail("claimDispatch", {
      actor: agent("spawned"),
      ref: "INC-1",
      dispatchToken: lease.dispatchToken,
    });
    expect(late.data.code).toBe("CONFLICT");

    const second = await h.call(
      "take",
      { actor: agent("waiter"), ref: "INC-1", dispatch: true },
      TakeCommandResultSchema,
    );
    if (second.outcome !== "dispatching")
      throw new Error("expected a second lease");
    const claimed = await h.call(
      "claimDispatch",
      {
        actor: agent("spawned"),
        ref: "INC-1",
        dispatchToken: second.dispatchToken,
      },
      IncidentDetailSchema,
    );
    expect(claimed.command).toMatchObject({
      state: "owned",
      commander: { key: "claude-code:spawned" },
    });
    expect(claimed.timeline.map((event) => event.type)).toEqual([
      "declared",
      "dispatched",
      "dispatch-expired",
      "dispatched",
      "claimed",
    ]);
  });

  it("refuses dispatch when spawning is disabled", async () => {
    const h = createHarness({ settings: { takeoverSpawnEnabled: false } });
    await h.call("declare", DECLARE, IncidentDetailSchema);
    const error = await h.fail("take", {
      actor: AGENT,
      ref: "INC-1",
      dispatch: true,
    });
    expect(error.data.code).toBe("PRECONDITION_FAILED");
  });

  it("hands off to a known actor and resolves as the new commander", async () => {
    const h = createHarness();
    const declared = await h.call(
      "declare",
      { ...DECLARE, takeCommand: true },
      IncidentDetailSchema,
    );
    await h.call(
      "join",
      { actor: agent("b"), ref: "INC-1" },
      IncidentDetailSchema,
    );
    const handed = await h.call(
      "handoff",
      {
        actor: AGENT,
        ref: "INC-1",
        expectedRevision: declared.revision + 1,
        to: "claude-code:b",
      },
      IncidentDetailSchema,
    );
    expect(handed.command.commander?.key).toBe("claude-code:b");
    const resolved = await h.call(
      "resolve",
      {
        actor: agent("b"),
        ref: "INC-1",
        expectedRevision: handed.revision,
        note: "Dispatch resumed: deployment 42 settled.",
      },
      IncidentDetailSchema,
    );
    expect(resolved).toMatchObject({
      status: "resolved",
      resolutionNote: "Dispatch resumed: deployment 42 settled.",
    });
    const reopened = await h.call(
      "reopen",
      {
        actor: AGENT,
        ref: "INC-1",
        expectedRevision: resolved.revision,
        note: "Stuck again",
      },
      IncidentDetailSchema,
    );
    expect(reopened.status).toBe("investigating");
  });
});

describe("browser actor", () => {
  const tailnet = {
    "tailscale-user-login": "Operator@Example.com",
    "tailscale-user-name": "Operator Example",
  };

  it("replaces a human body actor with the tailnet login and leaves agents alone", async () => {
    const h = createHarness();
    const human = { key: "human:browser", kind: "human", name: "Browser" };
    const declared = await h.call(
      "declare",
      { ...DECLARE, actor: human },
      IncidentDetailSchema,
      tailnet,
    );
    expect(declared.creator).toMatchObject({
      key: "human:operator@example.com",
      name: "Operator Example",
      kind: "human",
    });
    const joined = await h.call(
      "join",
      { actor: AGENT, ref: "INC-1" },
      IncidentDetailSchema,
      tailnet,
    );
    expect(joined.affected.map((entry) => entry.actor.key)).toEqual([
      AGENT.key,
    ]);
  });

  it("reports the viewer the ingress named", async () => {
    const h = createHarness();
    expect(
      await h.query("viewer", undefined, ActorInputSchema.nullable()),
    ).toBeNull();
    const response = await h.app.request("/api/incidents/trpc/viewer", {
      headers: tailnet,
    });
    expect(await response.json()).toMatchObject({
      result: { data: { key: "human:operator@example.com" } },
    });
  });
});

describe("queries", () => {
  it("lists open incidents by severity and filters by state, kind and system", async () => {
    const h = createHarness();
    await h.call(
      "declare",
      {
        ...DECLARE,
        severity: "sev3",
        systems: ["tracker"],
        title: "Tracker slow",
      },
      IncidentDetailSchema,
    );
    h.clock.now = minutes(1);
    await h.call("declare", DECLARE, IncidentDetailSchema);
    const open = await h.query("list", {}, IncidentSummarySchema.array());
    expect(open.map((incident) => incident.identifier)).toEqual([
      "INC-2",
      "INC-1",
    ]);
    expect(
      await h.query(
        "list",
        { system: "tracker" },
        IncidentSummarySchema.array(),
      ),
    ).toHaveLength(1);
    expect(
      await h.query(
        "list",
        { state: "resolved" },
        IncidentSummarySchema.array(),
      ),
    ).toEqual([]);
    expect(
      await h.query("list", undefined, IncidentSummarySchema.array()),
    ).toHaveLength(2);
  });

  it("reports an agent's relation to each open incident", async () => {
    const h = createHarness();
    await h.call(
      "declare",
      { ...DECLARE, suspect: { branch: "feature-a" } },
      IncidentDetailSchema,
    );
    const suspect = await h.query(
      "check",
      { actor: { ...agent("other"), metadata: { branch: "feature-a" } } },
      CheckIncidentsResultSchema,
    );
    expect(suspect.incidents[0]?.relation).toEqual({
      commander: false,
      creator: false,
      suspect: true,
      affected: false,
      canTake: true,
    });
    const bystander = await h.query(
      "check",
      { system: "delivery", actor: agent("bystander") },
      CheckIncidentsResultSchema,
    );
    expect(bystander.incidents[0]?.relation.canTake).toBe(false);
    expect(
      await h.query("check", { system: "tracker" }, CheckIncidentsResultSchema),
    ).toMatchObject({ incidents: [] });
  });
});

describe("incidents-enabled flag", () => {
  it("pauses writes and signals but keeps reads", async () => {
    const h = createHarness();
    await h.call("declare", DECLARE, IncidentDetailSchema);
    h.settings.current = { enabled: false };
    expect(await h.failCode("join", { actor: AGENT, ref: "INC-1" })).toBe(
      "FORBIDDEN",
    );
    expect(
      await h.failCode("declare", { ...DECLARE, systems: ["tracker"] }),
    ).toBe("FORBIDDEN");
    expect(
      await h.query("list", {}, IncidentSummarySchema.array()),
    ).toHaveLength(1);
    const ignored = await h.server.service.applySignals([
      {
        source: "main-ci",
        key: "main-ci:main",
        firing: true,
        system: "main-ci",
        severity: "sev2",
        title: "main is red",
        summary: "",
        exitCondition: "green",
        observedAt: minutes(1).toISOString(),
        links: [],
      },
    ]);
    expect(ignored.results).toEqual([
      { key: "main-ci:main", outcome: "ignored", identifier: null },
    ]);
  });
});

describe("fixture server", () => {
  it("seeds the five documented incidents", async () => {
    const now = new Date("2026-11-25T18:00:00.000Z");
    const server = await createIncidentsFixtureHubServer({ clock: () => now });
    const all = await server.service.list({ state: "all", limit: 50 });
    const open = await server.service.list({ state: "open", limit: 50 });
    expect(all).toHaveLength(5);
    expect(
      open.map((incident) => [
        incident.kind,
        incident.severity,
        incident.systems[0],
        incident.command.state,
      ]),
    ).toEqual([
      ["incident", "sev1", "delivery", "dispatching"],
      ["incident", "sev2", "main-ci", "owned"],
      ["incident", "sev3", "observability", "none"],
      ["maintenance", "sev3", "databases", "none"],
    ]);
    const unowned = open[2];
    expect(
      unowned !== undefined &&
        z.iso.datetime().parse(unowned.command.takeoverEligibleAt) <=
          now.toISOString(),
    ).toBe(true);
    const delivery = await server.service.byRef(open[0]?.identifier ?? "");
    expect(delivery.affected).toHaveLength(2);
    expect(
      z.iso.datetime().parse(delivery.command.leaseExpiresAt) >
        now.toISOString(),
    ).toBe(true);
    const mainCi = await server.service.byRef(open[1]?.identifier ?? "");
    expect(mainCi.suspect).toMatchObject({ prNumber: 5142 });
    expect(mainCi.status).toBe("identified");
    expect(
      all.find((incident) => incident.status === "resolved")?.systems,
    ).toEqual(["tracker"]);
  });
});

describe("signal watermarks and open priority (in-memory)", () => {
  it("orders retried, delayed, repeated, and tied reports by observation", async () => {
    const h = createHarness();
    expect(await runWatermarkScenario(h)).toEqual(WATERMARK_SCENARIO_EXPECTED);
  });

  it("keeps one incident and the newest watermark under concurrent reports", async () => {
    const h = createHarness();
    expect(await runWatermarkRace(h)).toEqual(WATERMARK_RACE_EXPECTED);
  });

  it("orders open incidents by severity before applying the limit", async () => {
    const h = createHarness();
    expect(await runPriorityScenario(h)).toEqual(PRIORITY_SCENARIO_EXPECTED);
  });

  it("does not let a retried firing reopen an auto-resolved outage over HTTP", async () => {
    const h = createHarness();
    const red = {
      source: "main-ci",
      key: "main-ci:main",
      firing: true,
      system: "main-ci",
      severity: "sev2",
      title: "main is red",
      exitCondition: "main is green",
      observedAt: minutes(0).toISOString(),
    };
    const send = (signals: unknown[]) =>
      jsonOf(
        h.app.request("/api/incidents/internal/signals", {
          method: "POST",
          headers: {
            authorization: `Bearer ${OPS_TOKEN}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ signals }),
        }),
      );
    await send([red]);
    await send([
      { ...red, firing: false, observedAt: minutes(5).toISOString() },
    ]);
    expect(await send([red])).toEqual({
      results: [{ key: "main-ci:main", outcome: "ignored", identifier: null }],
    });
    const all = await h.server.service.list({ state: "all", limit: 50 });
    expect(all.map((incident) => incident.status)).toEqual(["resolved"]);
  });
});
