import { describe, expect, it } from "vitest";
import {
  claimDispatch,
  expireLease,
  handoff,
  hashDispatchToken,
  isSuspect,
  releaseDispatch,
  take,
  type TakeRequest,
} from "#domain/command.ts";
import { IncidentError } from "#domain/errors.ts";
import { begin, type IncidentRecord } from "#domain/model.ts";
import {
  actor,
  contextAt,
  minutes,
  record,
  SETTINGS,
  T0,
} from "#testing/records.ts";

const TOKEN = "dispatch-token-0123456789";
const creator = actor("creator");
const other = actor("other");
const suspectSession = actor("suspect", {
  sessionLink: "session_01Suspect",
  branch: "feature-x",
});

function request(overrides: Partial<TakeRequest> = {}): TakeRequest {
  return {
    dispatch: false,
    force: false,
    note: null,
    dispatchToken: TOKEN,
    ...overrides,
  };
}

function owned(by = creator, at = T0): IncidentRecord {
  const decision = take(record(), contextAt(at, by), request(), SETTINGS);
  return decision.transition.next;
}

describe("suspect matching", () => {
  it("matches a Claude-Session URL against the session link or id, or the branch", () => {
    const suspect = { sessionId: "https://claude.ai/code/session_01Suspect/" };
    expect(isSuspect(suspect, { sessionLink: "session_01Suspect" })).toBe(true);
    expect(isSuspect(suspect, { sessionId: "session_01Suspect" })).toBe(true);
    expect(isSuspect(suspect, { sessionId: "session_other" })).toBe(false);
    expect(isSuspect({ branch: "feature-x" }, { branch: "feature-x" })).toBe(
      true,
    );
    expect(isSuspect({ commitSha: "abc1234" }, { repoHead: "abc1234" })).toBe(
      false,
    );
    expect(isSuspect(null, { branch: "feature-x" })).toBe(false);
  });
});

describe("take", () => {
  it("refuses others before the takeover grace and admits the creator and the suspect", () => {
    const base = record({ suspect: { branch: "feature-x" } });
    const early = take(base, contextAt(minutes(1), other), request(), SETTINGS);
    expect(early).toMatchObject({
      outcome: "taken",
      reason: "not-eligible-yet",
    });
    expect(early.transition.events).toEqual([]);
    expect(
      take(base, contextAt(minutes(1), creator), request(), SETTINGS).outcome,
    ).toBe("owned");
    expect(
      take(base, contextAt(minutes(1), suspectSession), request(), SETTINGS)
        .outcome,
    ).toBe("owned");
    const later = take(
      base,
      contextAt(minutes(10), other),
      request(),
      SETTINGS,
    );
    expect(later.outcome).toBe("owned");
    expect(later.transition.next).toMatchObject({
      commandState: "owned",
      commanderId: "other",
      everClaimed: true,
    });
  });

  it("records force before the grace on the timeline", () => {
    const forced = take(
      record(),
      contextAt(minutes(1), other),
      request({ force: true }),
      SETTINGS,
    );
    expect(forced.outcome).toBe("owned");
    expect(forced.transition.events[0]?.data).toMatchObject({
      forced: true,
      overrode: "not-eligible-yet",
    });
  });

  it("is idempotent for the commander and yields to an existing owner", () => {
    const current = owned();
    const again = take(
      current,
      contextAt(minutes(20), creator),
      request(),
      SETTINGS,
    );
    expect(again.outcome).toBe("owned");
    expect(again.transition.events).toEqual([]);
    expect(
      take(current, contextAt(minutes(20), other), request(), SETTINGS),
    ).toMatchObject({
      outcome: "taken",
      reason: "owned-by-other",
    });
    const displaced = take(
      current,
      contextAt(minutes(20), other),
      request({ force: true }),
      SETTINGS,
    );
    expect(displaced.transition.next.commanderId).toBe("other");
    expect(displaced.transition.events[0]?.data).toMatchObject({
      forced: true,
      previousCommanderId: "creator",
    });
  });

  it("refuses resolved incidents", () => {
    expect(() =>
      take(
        { ...record(), status: "resolved" },
        contextAt(T0, creator),
        request(),
        SETTINGS,
      ),
    ).toThrow(IncidentError);
  });
});

function leased() {
  const decision = take(
    record(),
    contextAt(minutes(10), other),
    request({ dispatch: true }),
    SETTINGS,
  );
  if (decision.outcome !== "dispatching")
    throw new Error("expected a dispatch lease");
  return decision;
}

describe("dispatch lease", () => {
  it("stores only the token hash and leases for the configured time", () => {
    const decision = leased();
    expect(decision.leaseExpiresAt).toEqual(minutes(20));
    expect(decision.provider).toBe("claude-code");
    expect(decision.transition.next).toMatchObject({
      commandState: "dispatching",
      dispatcherId: "other",
      dispatchTokenHash: hashDispatchToken(TOKEN),
    });
    expect(JSON.stringify(decision.transition.next)).not.toContain(TOKEN);
  });

  it("refuses to dispatch when spawning is disabled", () => {
    expect(() =>
      take(
        record(),
        contextAt(minutes(10), other),
        request({ dispatch: true }),
        {
          ...SETTINGS,
          takeoverSpawnEnabled: false,
        },
      ),
    ).toThrow(/disabled/u);
  });

  it("blocks other takers while the lease is live", () => {
    const lease = leased().transition.next;
    expect(
      take(lease, contextAt(minutes(15), creator), request(), SETTINGS),
    ).toMatchObject({
      outcome: "taken",
      reason: "dispatch-in-progress",
    });
  });

  it("lets the spawned session redeem the token once", () => {
    const lease = leased().transition.next;
    const spawned = actor("spawned");
    expect(() =>
      claimDispatch(
        lease,
        contextAt(minutes(12), spawned),
        "wrong-token-0123456789",
      ),
    ).toThrow(/does not match/u);
    const claimed = claimDispatch(
      lease,
      contextAt(minutes(12), spawned),
      TOKEN,
    );
    expect(claimed.next).toMatchObject({
      commandState: "owned",
      commanderId: "spawned",
      dispatchTokenHash: null,
    });
    expect(claimed.events[0]?.data).toEqual({
      viaDispatch: true,
      dispatcherId: "other",
    });
    expect(
      claimDispatch(claimed.next, contextAt(minutes(13), spawned), TOKEN)
        .events,
    ).toEqual([]);
    expect(() =>
      claimDispatch(claimed.next, contextAt(minutes(13), actor("late")), TOKEN),
    ).toThrow(/no active dispatch lease/u);
  });

  it("lapses lazily back to none with a dispatch-expired event", () => {
    const lease = leased().transition.next;
    expect(
      expireLease(begin(lease), contextAt(minutes(19), null)).events,
    ).toEqual([]);
    const lapsed = expireLease(begin(lease), contextAt(minutes(20), null));
    expect(lapsed.next).toMatchObject({
      commandState: "none",
      dispatcherId: null,
      leaseExpiresAt: null,
    });
    expect(lapsed.events.map((event) => [event.type, event.actorId])).toEqual([
      ["dispatch-expired", null],
    ]);
    const retaken = take(
      lease,
      contextAt(minutes(21), creator),
      request(),
      SETTINGS,
    );
    expect(retaken.outcome).toBe("owned");
    expect(retaken.transition.events.map((event) => event.type)).toEqual([
      "dispatch-expired",
      "claimed",
    ]);
    expect(() =>
      claimDispatch(lease, contextAt(minutes(21), actor("spawned")), TOKEN),
    ).toThrow(IncidentError);
  });

  it("gives the lease back on spawn failure, and no-ops once it lapsed", () => {
    const lease = leased().transition.next;
    const released = releaseDispatch(
      lease,
      contextAt(minutes(11), other),
      TOKEN,
      "herdr-new-worktree failed",
    );
    expect(released.next.commandState).toBe("none");
    expect(released.events[0]).toMatchObject({
      type: "released",
      body: "herdr-new-worktree failed",
    });
    expect(() =>
      releaseDispatch(
        lease,
        contextAt(minutes(11), other),
        "wrong-token-0123456789",
        "x",
      ),
    ).toThrow(IncidentError);
    expect(
      releaseDispatch(
        lease,
        contextAt(minutes(30), other),
        TOKEN,
        "late",
      ).events.map((event) => event.type),
    ).toEqual(["dispatch-expired"]);
  });
});

describe("handoff", () => {
  it("lets only the commander hand off or release", () => {
    const current = owned();
    expect(() => handoff(current, contextAt(T0, other), other, null)).toThrow(
      /Only the commander/u,
    );
    const handed = handoff(
      current,
      contextAt(T0, creator),
      other,
      "Going offline",
    );
    expect(handed.next.commanderId).toBe("other");
    expect(handed.events[0]).toMatchObject({
      type: "handed-off",
      body: "Going offline",
    });
    const released = handoff(handed.next, contextAt(T0, other), null, null);
    expect(released.next).toMatchObject({
      commandState: "none",
      commanderId: null,
      everClaimed: true,
    });
    expect(
      handoff(current, contextAt(T0, creator), creator, null).events,
    ).toEqual([]);
  });
});
