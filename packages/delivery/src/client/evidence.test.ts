import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { createChangeFeed } from "./change-feed.ts";
import {
  deploymentEvidenceCount,
  groupEvidence,
  humanizeKey,
  isWideValue,
  parseEvidenceSummary,
  type EvidenceItem,
} from "./evidence.ts";

const DEPLOYMENT = "45cf1828-0f01-4bcd-8dab-592769df488f";
const DIGEST = `sha256:${"7".repeat(64)}`;

describe("humanizeKey", () => {
  it("turns a receipt key into a label", () => {
    expect(humanizeKey("planDigest")).toBe("Plan digest");
    expect(humanizeKey("sourceBuildId")).toBe("Source build ID");
    expect(humanizeKey("carriedFromVersionSetRevisionId")).toBe(
      "Carried from version set revision ID",
    );
    expect(humanizeKey("uid")).toBe("UID");
    expect(humanizeKey("matches-processed")).toBe("Matches processed");
    expect(humanizeKey("schema.version")).toBe("Schema version");
    expect(humanizeKey("stack")).toBe("Stack");
  });
});

describe("parseEvidenceSummary", () => {
  it("shows prose as written", () => {
    expect(parseEvidenceSummary("acceptance checks passed")).toEqual({
      kind: "text",
      text: "acceptance checks passed",
    });
  });

  it("treats only a JSON object as a record", () => {
    for (const summary of [
      '["a","b"]',
      '"quoted"',
      "42",
      "null",
      "{not json}",
      '{"unterminated": ',
      "{braces} that open a sentence",
    ])
      expect(parseEvidenceSummary(summary)).toEqual({
        kind: "text",
        text: summary,
      });
  });

  it("reads the adapter as the label and scalar fields as facts", () => {
    const parsed = parseEvidenceSummary(
      JSON.stringify({
        adapter: "tofu",
        step: "plan",
        stack: "cloudflare",
        planDigest: DIGEST,
        serial: 7,
        accepted: true,
        previous: null,
      }),
    );
    expect(parsed).toEqual({
      kind: "record",
      adapter: "tofu",
      facts: [
        { key: "step", label: "Step", value: { kind: "text", text: "plan" } },
        {
          key: "stack",
          label: "Stack",
          value: { kind: "text", text: "cloudflare" },
        },
        {
          key: "planDigest",
          label: "Plan digest",
          value: { kind: "identifier", value: DIGEST },
        },
        { key: "serial", label: "Serial", value: { kind: "text", text: "7" } },
        {
          key: "accepted",
          label: "Accepted",
          value: { kind: "text", text: "yes" },
        },
        {
          key: "previous",
          label: "Previous",
          value: { kind: "text", text: "none" },
        },
      ],
      nested: [],
    });
  });

  it("has no label when the receipt names no adapter", () => {
    const parsed = parseEvidenceSummary(
      JSON.stringify({ namespace: "delivery-platform-jobs", uid: DEPLOYMENT }),
    );
    expect(parsed).toMatchObject({ kind: "record", adapter: null });
    expect(
      parsed.kind === "record" && parsed.facts.map((fact) => fact.label),
    ).toEqual(["Namespace", "UID"]);
  });

  it("keeps an adapter that is not a string as an ordinary field", () => {
    const parsed = parseEvidenceSummary('{"adapter":{"name":"x","v":[1]}}');
    expect(parsed).toMatchObject({ kind: "record", adapter: null });
    expect(
      parsed.kind === "record" && parsed.nested.map((entry) => entry.key),
    ).toEqual(["adapter"]);
  });

  it("classifies ids, times and links, and leaves names readable", () => {
    const parsed = parseEvidenceSummary(
      JSON.stringify({
        uid: DEPLOYMENT,
        revision: "c".repeat(40),
        environment: "delivery-control-plane/prod",
        activeAt: "2026-11-20T08:43:58.160Z",
        dashboard: "https://grafana.sjer.red/d/velero/backups",
        message: "Deployment scout-backend exceeded its progress deadline",
      }),
    );
    expect(
      parsed.kind === "record" && parsed.facts.map((fact) => fact.value.kind),
    ).toEqual(["identifier", "identifier", "text", "time", "link", "text"]);
  });

  it("reads a flat nested value inline and folds a deep or long one away", () => {
    const parsed = parseEvidenceSummary(
      JSON.stringify({
        adapter: "worker-rollout-plan",
        changes: { create: 2, update: 1, delete: 0, replace: 0 },
        applied: ["add_coach_options", "voice_models"],
        drained: [],
        plan: { target: "scout-prod", routes: [{ ramp: 100 }] },
        retained: ["8".repeat(40), "7".repeat(40), "6".repeat(40)],
      }),
    );
    expect(parsed).toEqual({
      kind: "record",
      adapter: "worker-rollout-plan",
      facts: [
        {
          key: "changes",
          label: "Changes",
          value: {
            kind: "text",
            text: "create 2 · update 1 · delete 0 · replace 0",
          },
        },
        {
          key: "applied",
          label: "Applied",
          value: { kind: "text", text: "add_coach_options, voice_models" },
        },
        {
          key: "drained",
          label: "Drained",
          value: { kind: "text", text: "none" },
        },
      ],
      nested: [
        {
          key: "plan",
          label: "Plan",
          json: JSON.stringify(
            { target: "scout-prod", routes: [{ ramp: 100 }] },
            null,
            2,
          ),
        },
        {
          key: "retained",
          label: "Retained",
          json: JSON.stringify(
            ["8".repeat(40), "7".repeat(40), "6".repeat(40)],
            null,
            2,
          ),
        },
      ],
    });
  });
});

describe("isWideValue", () => {
  it("gives a sentence or a link a row of its own", () => {
    expect(isWideValue({ kind: "text", text: "Healthy" })).toBe(false);
    expect(
      isWideValue({
        kind: "text",
        text: "Deployment scout-backend exceeded its progress deadline",
      }),
    ).toBe(true);
    expect(isWideValue({ kind: "link", url: "https://sjer.red" })).toBe(true);
    expect(isWideValue({ kind: "identifier", value: DIGEST })).toBe(false);
  });
});

function item(id: string): EvidenceItem {
  return {
    id,
    deploymentId: DEPLOYMENT,
    kind: "runtime",
    summary: id,
    createdAt: "2026-11-20T08:43:58.160Z",
  };
}

/** The ids of a group, in order. */
function ids(items: EvidenceItem[]) {
  return items.map((entry) => entry.id);
}

describe("groupEvidence", () => {
  const evidence = [
    item(`${DEPLOYMENT}/stage/step-sync/0`),
    item(`${DEPLOYMENT}/stage/step-sync/1`),
    item(`${DEPLOYMENT}/stage/step-sync/drain/0`),
    item(`${DEPLOYMENT}/stage/step-gone/0`),
    item(`${DEPLOYMENT}/finish/0`),
    item(`${DEPLOYMENT}/monitor/alarms/${"a".repeat(64)}`),
    item(`${DEPLOYMENT}/monitor/2/${"b".repeat(64)}`),
    item(`${DEPLOYMENT}/drift/${"c".repeat(64)}`),
    item(`${DEPLOYMENT}/recovery/argo/model/beta/recovery/0`),
    item(`${DEPLOYMENT}/recovery/argo/model/beta/recovery/1`),
    item(`${DEPLOYMENT}/worker-recovery/intent-1/0`),
    item("evidence/scout-prod-42/alarm"),
  ];
  const groups = groupEvidence(
    DEPLOYMENT,
    ["step-render", "step-sync", "step-sync/drain"],
    evidence,
  );

  it("puts each step's evidence under exactly that step", () => {
    expect(ids(groups.steps.get("step-sync") ?? [])).toEqual([
      `${DEPLOYMENT}/stage/step-sync/0`,
      `${DEPLOYMENT}/stage/step-sync/1`,
    ]);
    expect(ids(groups.steps.get("step-sync/drain") ?? [])).toEqual([
      `${DEPLOYMENT}/stage/step-sync/drain/0`,
    ]);
    expect(groups.steps.get("step-render")).toEqual([]);
  });

  it("keeps evidence of a step the deployment does not list, under its key", () => {
    expect(
      groups.unlistedSteps.map((step) => [step.key, ids(step.items)]),
    ).toEqual([["step-gone", [`${DEPLOYMENT}/stage/step-gone/0`]]]);
  });

  it("groups the result, monitor, drift and each recovery intent", () => {
    expect(ids(groups.finish)).toEqual([`${DEPLOYMENT}/finish/0`]);
    expect(groups.monitor).toHaveLength(2);
    expect(groups.drift).toHaveLength(1);
    expect(
      groups.recovery.map((entry) => [
        entry.recovery,
        entry.intentId,
        entry.items.length,
      ]),
    ).toEqual([
      ["argo", "argo/model/beta/recovery", 2],
      ["worker", "intent-1", 1],
    ]);
  });

  it("keeps an id outside the grammar as other evidence", () => {
    expect(ids(groups.other)).toEqual(["evidence/scout-prod-42/alarm"]);
  });

  it("drops nothing", () => {
    const underSteps = [...groups.steps.values()].reduce(
      (sum, items) => sum + items.length,
      0,
    );
    expect(deploymentEvidenceCount(groups)).toBe(9);
    expect(underSteps + deploymentEvidenceCount(groups)).toBe(evidence.length);
  });
});

describe("createChangeFeed", () => {
  it("coalesces rapid change events into one deduplicated invalidation batch and flushes resync immediately", async () => {
    vi.useFakeTimers();
    try {
      const queryClient = new QueryClient();
      const invalidate = vi
        .spyOn(queryClient, "invalidateQueries")
        .mockResolvedValue();
      const target = new EventTarget();
      const feed = createChangeFeed(queryClient, {
        coalesceMs: 150,
        openEventSource: () => target,
      });
      feed.start();
      const emit = (type: string, data?: unknown) => {
        const event =
          data === undefined
            ? new Event(type)
            : new MessageEvent(type, { data: JSON.stringify(data) });
        target.dispatchEvent(event);
      };

      emit("ready");
      expect(feed.getSnapshot()).toBe("live");
      expect(invalidate).not.toHaveBeenCalled();

      for (const entityId of ["b1", "b2", "b3"])
        emit("change", {
          id: entityId,
          domain: "build",
          action: "build.verified",
          entityId,
        });
      expect(invalidate).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(150);
      const hubCalls = invalidate.mock.calls.filter(
        ([filters]) => JSON.stringify(filters?.queryKey) === '["hub"]',
      );
      expect(hubCalls).toHaveLength(1);

      invalidate.mockClear();
      emit("change", {
        id: "b4",
        domain: "build",
        action: "build.verified",
        entityId: "b4",
      });
      emit("resync");
      expect(invalidate).toHaveBeenCalledTimes(1);
      expect(invalidate).toHaveBeenLastCalledWith();

      await vi.advanceTimersByTimeAsync(150);
      expect(invalidate).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
