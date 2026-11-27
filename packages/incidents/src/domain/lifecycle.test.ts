import { describe, expect, it } from "vitest";
import {
  INCIDENT_STATUSES,
  IncidentSeveritySchema,
  MAINTENANCE_STATUSES,
} from "#shared/contract.ts";
import { compareOpenPriority } from "#domain/model.ts";
import { assertNoOverlap, findOverlap, heldSystems } from "#domain/dedupe.ts";
import { IncidentError } from "#domain/errors.ts";
import {
  addLink,
  changeStatus,
  declare,
  edit,
  join,
  leave,
  reopen,
  resolve,
} from "#domain/incident.ts";
import {
  canMove,
  reopenTarget,
  resolveTarget,
  STATUS_MOVES,
} from "#domain/lifecycle.ts";
import { take } from "#domain/command.ts";
import {
  actor,
  contextAt,
  declareFields,
  minutes,
  record,
  SETTINGS,
  T0,
} from "#testing/records.ts";

const jerred = actor("jerred");

describe("status machine", () => {
  it("keeps each kind's moves inside its own statuses", () => {
    for (const status of INCIDENT_STATUSES)
      for (const to of STATUS_MOVES[status])
        expect(INCIDENT_STATUSES).toContain(to);
    for (const status of MAINTENANCE_STATUSES)
      for (const to of STATUS_MOVES[status])
        expect(MAINTENANCE_STATUSES).toContain(to);
  });

  it("lets incident statuses move back and forth but never into a terminal state", () => {
    expect(canMove("incident", "monitoring", "investigating")).toBe(true);
    expect(canMove("incident", "investigating", "resolved")).toBe(false);
    expect(canMove("incident", "investigating", "in_progress")).toBe(false);
    expect(canMove("maintenance", "scheduled", "canceled")).toBe(true);
    expect(canMove("maintenance", "scheduled", "verifying")).toBe(false);
  });

  it("resolves incidents from any open status and maintenance only once started", () => {
    expect(resolveTarget("incident", "investigating")).toBe("resolved");
    expect(resolveTarget("incident", "resolved")).toBeNull();
    expect(resolveTarget("maintenance", "scheduled")).toBeNull();
    expect(resolveTarget("maintenance", "verifying")).toBe("completed");
    expect(reopenTarget("resolved")).toBe("investigating");
    expect(reopenTarget("completed")).toBe("in_progress");
    expect(reopenTarget("canceled")).toBeNull();
  });

  it("records mitigation on entering monitoring, once", () => {
    const base = record();
    const monitoring = changeStatus(
      base,
      contextAt(minutes(5), jerred),
      "monitoring",
      null,
    );
    expect(monitoring.next.mitigatedAt).toEqual(minutes(5));
    expect(monitoring.events.map((event) => event.type)).toEqual([
      "status-changed",
    ]);
    const back = changeStatus(
      monitoring.next,
      contextAt(minutes(6), jerred),
      "investigating",
      null,
    );
    const again = changeStatus(
      back.next,
      contextAt(minutes(7), jerred),
      "monitoring",
      null,
    );
    expect(again.next.mitigatedAt).toEqual(minutes(5));
  });

  it("refuses terminal targets through changeStatus and requires a cancel note", () => {
    expect(() =>
      changeStatus(record(), contextAt(T0, jerred), "resolved", null),
    ).toThrow(/use resolve/u);
    const maintenance = record({ kind: "maintenance", systems: ["databases"] });
    expect(() =>
      changeStatus(maintenance, contextAt(T0, jerred), "canceled", null),
    ).toThrow(IncidentError);
    const canceled = changeStatus(
      maintenance,
      contextAt(T0, jerred),
      "canceled",
      "Postponed to Friday",
    );
    expect(canceled.next.status).toBe("canceled");
    expect(canceled.next.resolutionNote).toBe("Postponed to Friday");
  });

  it("treats a move to the current status as no change", () => {
    expect(
      changeStatus(record(), contextAt(T0, jerred), "investigating", null)
        .events,
    ).toEqual([]);
  });
});

describe("declare", () => {
  it("starts incidents investigating with a takeover grace from declaration", () => {
    const declared = declare(
      declareFields({ components: ["a", "a"] }),
      contextAt(T0, jerred),
      {
        open: [],
        takeoverGraceSeconds: 600,
      },
    );
    expect(declared.next.status).toBe("investigating");
    expect(declared.next.takeoverEligibleAt).toEqual(minutes(10));
    expect(declared.next.creatorId).toBe("jerred");
    expect(declared.next.components).toEqual(["a"]);
    expect(declared.events.map((event) => [event.seq, event.type])).toEqual([
      [1, "declared"],
    ]);
  });

  it("takes command at declaration when asked", () => {
    const declared = declare(
      declareFields({ takeCommand: true }),
      contextAt(T0, jerred),
      {
        open: [],
        takeoverGraceSeconds: 600,
      },
    );
    expect(declared.next.commandState).toBe("owned");
    expect(declared.next.commanderId).toBe("jerred");
    expect(declared.next.everClaimed).toBe(true);
    expect(declared.events.map((event) => event.type)).toEqual([
      "declared",
      "claimed",
    ]);
  });

  it("validates maintenance windows", () => {
    expect(() =>
      declare(
        declareFields({ scheduledStart: T0.toISOString() }),
        contextAt(T0, jerred),
        {
          open: [],
          takeoverGraceSeconds: 600,
        },
      ),
    ).toThrow(/Only maintenance/u);
    expect(() =>
      declare(
        declareFields({
          kind: "maintenance",
          scheduledStart: minutes(60).toISOString(),
          scheduledEnd: minutes(30).toISOString(),
        }),
        contextAt(T0, jerred),
        { open: [], takeoverGraceSeconds: 600 },
      ),
    ).toThrow(/after scheduledStart/u);
  });
});

describe("dedupe", () => {
  const open = record({ systems: ["delivery", "argocd"] }, { number: 7 });

  it("holds systems only for open incident-kind records and never for other", () => {
    expect(heldSystems(open)).toEqual(["delivery", "argocd"]);
    expect(heldSystems(record({ systems: ["other"] }))).toEqual([]);
    expect(
      heldSystems(record({ kind: "maintenance", systems: ["delivery"] })),
    ).toEqual([]);
    expect(heldSystems({ ...open, status: "resolved" })).toEqual([]);
  });

  it("refuses a declaration overlapping an open incident and names it", () => {
    try {
      record({ systems: ["argocd", "cluster"] }, { open: [open] });
      expect.unreachable();
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(IncidentError);
      if (!(error instanceof IncidentError)) return;
      expect(error.code).toBe("CONFLICT");
      expect(error.conflict).toMatchObject({
        kind: "duplicate",
        systems: ["argocd"],
      });
    }
  });

  it("allows maintenance and other-only incidents alongside", () => {
    expect(() =>
      record({ kind: "maintenance", systems: ["delivery"] }, { open: [open] }),
    ).not.toThrow();
    expect(() =>
      record({ systems: ["other"] }, { open: [open] }),
    ).not.toThrow();
    expect(findOverlap(open, [open], open.id)).toBeNull();
  });

  it("checks edits and reopenings against other open incidents", () => {
    const tracker = record({ systems: ["tracker"] }, { number: 8 });
    expect(() =>
      edit(
        tracker,
        contextAt(T0, jerred),
        { systems: ["tracker", "delivery"] },
        [open],
      ),
    ).toThrow(IncidentError);
    const resolved = {
      ...record({ systems: ["delivery"] }, { number: 9 }),
      status: "resolved" as const,
    };
    expect(() =>
      reopen(resolved, contextAt(T0, jerred), "Regressed", [open]),
    ).toThrow(IncidentError);
    expect(() => assertNoOverlap(resolved, [open])).not.toThrow();
  });
});

describe("edit, links, and membership", () => {
  it("records changed fields and severity separately and ignores no-op edits", () => {
    const base = record();
    const edited = edit(
      base,
      contextAt(T0, jerred),
      { title: "New title", severity: "sev1", summary: base.summary },
      [],
    );
    expect(edited.events.map((event) => [event.type, event.data])).toEqual([
      ["edited", { fields: ["title"] }],
      ["severity-changed", { from: "sev2", to: "sev1" }],
    ]);
    expect(
      edit(base, contextAt(T0, jerred), { title: base.title }, []).events,
    ).toEqual([]);
  });

  it("dedupes links and membership", () => {
    const base = record();
    const link = { kind: "pr" as const, ref: "5140" };
    const linked = addLink(base, contextAt(T0, jerred), link);
    expect(linked.next.links).toHaveLength(1);
    expect(addLink(linked.next, contextAt(T0, jerred), link).events).toEqual(
      [],
    );
    const joined = join(base, contextAt(T0, jerred), "blocked deploying");
    expect(joined.next.affected).toEqual([{ actorId: "jerred", joinedAt: T0 }]);
    expect(join(joined.next, contextAt(T0, jerred), null).events).toEqual([]);
    expect(
      leave(joined.next, contextAt(T0, jerred), null).next.affected,
    ).toEqual([]);
    expect(leave(base, contextAt(T0, jerred), null).events).toEqual([]);
  });
});

describe("resolve and reopen", () => {
  it("lets only the commander resolve unless forced", () => {
    const base = record();
    expect(() =>
      resolve(base, contextAt(T0, jerred), { note: "fixed", force: false }),
    ).toThrow(/Only the commander/u);
    const owned = take(
      base,
      contextAt(minutes(11), jerred),
      {
        dispatch: false,
        force: false,
        note: null,
        dispatchToken: "x".repeat(16),
      },
      SETTINGS,
    ).transition.next;
    const resolved = resolve(owned, contextAt(minutes(20), jerred), {
      note: "Pipeline #19257 green",
      force: false,
    });
    expect(resolved.next).toMatchObject({
      status: "resolved",
      resolutionNote: "Pipeline #19257 green",
      resolvedAt: minutes(20),
    });
    expect(resolved.events.at(-1)?.data).toEqual({
      forced: false,
      auto: false,
    });
    const forced = resolve(base, contextAt(T0, actor("other")), {
      note: "fixed elsewhere",
      force: true,
    });
    expect(forced.events.at(-1)?.data).toEqual({ forced: true, auto: false });
  });

  it("reopens to the kind's working status and clears the resolution", () => {
    const resolved = resolve(record(), contextAt(T0, jerred), {
      note: "fixed",
      force: true,
    }).next;
    expect(() =>
      resolve(resolved, contextAt(T0, jerred), { note: "again", force: true }),
    ).toThrow(/already resolved/u);
    const reopened = reopen(
      resolved,
      contextAt(minutes(1), jerred),
      "It came back",
      [],
    );
    expect(reopened.next).toMatchObject({
      status: "investigating",
      resolvedAt: null,
      resolutionNote: null,
    });
    expect(() =>
      reopen(reopened.next, contextAt(T0, jerred), "again", []),
    ).toThrow(IncidentError);
  });
});

function at(severity: "sev1" | "sev2" | "sev3", minute: number) {
  return { severity, declaredAt: minutes(minute) };
}

describe("open priority", () => {
  it("orders by severity, then newest, and severity names sort lexically in rank order", () => {
    const sorted = [
      at("sev3", 9),
      at("sev1", 0),
      at("sev2", 5),
      at("sev1", 3),
    ].sort(compareOpenPriority);
    expect(sorted).toEqual([
      at("sev1", 3),
      at("sev1", 0),
      at("sev2", 5),
      at("sev3", 9),
    ]);
    // The PostgreSQL repository relies on this with `ORDER BY severity ASC`.
    expect([...IncidentSeveritySchema.options].sort()).toEqual([
      "sev1",
      "sev2",
      "sev3",
    ]);
  });
});
