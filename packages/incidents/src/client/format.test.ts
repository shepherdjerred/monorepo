import { describe, expect, it } from "vitest";
import {
  commandActions,
  describeCommand,
  eventDetail,
  formatSpan,
  sortIncidents,
  statusMoves,
} from "#client/format.ts";
import {
  dispatching,
  FIXER,
  NOW_MS,
  owned,
  summary,
  unowned,
  VIEWER_KEY,
  actorRecord,
  detail,
} from "#client/test-records.ts";

describe("describeCommand", () => {
  it("names the commander when command is owned", () => {
    const view = describeCommand(owned(FIXER), NOW_MS, "incident");
    expect(view.state).toBe("owned");
    expect(view.label).toBe("Owned by claude-code · temporal-schedule-split");
    expect(view.tone).toBe("ok");
  });

  it("shows the dispatch lease deadline and who holds it", () => {
    const view = describeCommand(dispatching(90), NOW_MS, "incident");
    expect(view.state).toBe("dispatching");
    expect(view.label).toMatch(/^Dispatching to new session until /u);
    expect(view.detail).toBe(
      "Lease held by codex · media-acquisition; 1h 30m left",
    );
  });

  it("separates an unowned incident that is eligible now from one that is not yet", () => {
    expect(describeCommand(unowned(-1), NOW_MS, "incident")).toMatchObject({
      state: "eligible",
      label: "Unowned — takeover eligible now",
    });
    const waiting = describeCommand(unowned(6), NOW_MS, "incident");
    expect(waiting.state).toBe("waiting");
    expect(waiting.label).toMatch(/^Unowned — takeover eligible at /u);
    expect(waiting.detail).toContain("(6m)");
  });
});

function actions(overrides: Parameters<typeof detail>[0], viewer = VIEWER_KEY) {
  return commandActions(detail(overrides), viewer, NOW_MS);
}

describe("describeCommand for maintenance", () => {
  it("names an owner or says there is none, with no takeover language", () => {
    expect(describeCommand(owned(FIXER), NOW_MS, "maintenance")).toMatchObject({
      state: "owned",
      label: "Owner: claude-code · temporal-schedule-split",
    });
    for (const eligibleIn of [-5, 5])
      expect(
        describeCommand(unowned(eligibleIn), NOW_MS, "maintenance"),
      ).toEqual({
        state: "unowned",
        tone: "unknown",
        label: "No owner",
        detail: null,
      });
  });
});

describe("commandActions", () => {
  it("offers Take on an unowned incident past its takeover grace", () => {
    expect(actions({ command: unowned(-1) })).toMatchObject({
      canTake: true,
      canForce: false,
      canRelease: false,
    });
  });

  it("offers only Force before the grace, unless the viewer declared it", () => {
    expect(actions({ command: unowned(5) })).toMatchObject({
      canTake: false,
      canForce: true,
    });
    expect(
      actions({ command: unowned(5), creator: actorRecord(VIEWER_KEY) }),
    ).toMatchObject({ canTake: true, canForce: false });
  });

  it("offers Force against another commander or a live dispatch lease", () => {
    expect(actions({ command: owned(FIXER) })).toMatchObject({
      canTake: false,
      canForce: true,
      isCommander: false,
    });
    expect(actions({ command: dispatching(30) })).toMatchObject({
      canTake: false,
      canForce: true,
    });
  });

  it("gives the commander Release and Hand off instead of Take", () => {
    expect(actions({ command: owned(actorRecord(VIEWER_KEY)) })).toMatchObject({
      isCommander: true,
      canTake: false,
      canForce: false,
      canRelease: true,
    });
  });

  it("lets anyone take unowned maintenance at once, like the domain", () => {
    expect(
      actions({
        kind: "maintenance",
        status: "scheduled",
        systems: ["databases"],
        command: unowned(5),
      }),
    ).toMatchObject({ canTake: true, canForce: false });
  });

  it("follows the lifecycle for resolve and reopen", () => {
    expect(actions({ status: "resolved" })).toMatchObject({
      canResolve: false,
      canReopen: true,
      canTake: false,
      canForce: false,
    });
    expect(actions({ kind: "maintenance", status: "scheduled" })).toMatchObject(
      { canResolve: false, canReopen: false },
    );
    expect(actions({ kind: "maintenance", status: "verifying" })).toMatchObject(
      { canResolve: true },
    );
  });
});

describe("statusMoves", () => {
  it("offers only the moves the domain accepts for each kind", () => {
    expect(statusMoves("incident", "investigating")).toEqual([
      "identified",
      "mitigating",
      "monitoring",
    ]);
    expect(statusMoves("maintenance", "scheduled")).toEqual([
      "in_progress",
      "canceled",
    ]);
    expect(statusMoves("incident", "resolved")).toEqual([]);
  });
});

describe("sortIncidents", () => {
  it("puts open records first, then the most severe, then the newest", () => {
    const sorted = sortIncidents([
      summary({ number: 1, severity: "sev1", status: "resolved" }),
      summary({
        number: 2,
        severity: "sev3",
        declaredAt: "2026-11-25T11:00:00.000Z",
      }),
      summary({
        number: 3,
        severity: "sev2",
        declaredAt: "2026-11-25T10:00:00.000Z",
      }),
      summary({
        number: 4,
        severity: "sev2",
        declaredAt: "2026-11-25T11:30:00.000Z",
      }),
    ]);
    expect(sorted.map((incident) => incident.identifier)).toEqual([
      "INC-4",
      "INC-3",
      "INC-2",
      "INC-1",
    ]);
  });
});

describe("formatting", () => {
  it("renders spans compactly", () => {
    expect(formatSpan(42_000)).toBe("42s");
    expect(formatSpan(12 * 60_000)).toBe("12m");
    expect(formatSpan(185 * 60_000)).toBe("3h 05m");
    expect(formatSpan(52 * 60 * 60_000)).toBe("2d 4h");
  });

  it("summarizes structured timeline data", () => {
    expect(
      eventDetail("status-changed", {
        from: "investigating",
        to: "identified",
      }),
    ).toBe("investigating → identified");
    expect(
      eventDetail("claimed", { forced: true, overrode: "owned-by-other" }),
    ).toBe("Forced, overriding owned-by-other");
    expect(eventDetail("resolved", { forced: false, auto: true })).toBe(
      "Every attached signal cleared",
    );
    expect(eventDetail("update", null)).toBeNull();
  });
});
