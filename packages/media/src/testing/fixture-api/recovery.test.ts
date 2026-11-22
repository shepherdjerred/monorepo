import { describe, expect, it } from "vitest";
import { RecoveryDetailSchema, RecoveryListSchema } from "#shared/recovery.ts";
import { LegacyRequesterListSchema } from "#shared/recovery-claims.ts";
import { isWaitingState } from "#client/presentation/recovery.ts";
import { MEMBER, OWNER, type Persona } from "./personas.ts";
import { routeFixture } from "./router.ts";
import type { FixtureScenario } from "./scenario.ts";
import { fixtureId } from "./support.ts";

/** One read below `/api`, as a browser in `scenario` makes it. */
function read(path: string, persona: Persona, scenario?: FixtureScenario) {
  return routeFixture({
    method: "GET",
    url: new URL(`http://fixture.invalid/api${path}`),
    persona,
    ...(scenario === undefined ? {} : { scenario }),
  });
}

function list(persona: Persona, scenario?: FixtureScenario) {
  const outcome = read("/v1/recovery", persona, scenario);
  if (outcome.status !== 200) {
    throw new Error(`/recovery answered ${String(outcome.status)}`);
  }
  return RecoveryListSchema.parse(outcome.body);
}

function detail(persona: Persona, n: number) {
  const outcome = read(`/v1/recovery/reviews/${fixtureId(16, n)}`, persona);
  if (outcome.status !== 200) {
    throw new Error(`review ${String(n)} answered ${String(outcome.status)}`);
  }
  return RecoveryDetailSchema.parse(outcome.body);
}

describe("recovery fixtures", () => {
  it("lists one open review and two applied ones, with the restore's held titles", () => {
    const owner = list("owner");
    expect(owner.reviews.map((review) => review.state)).toEqual([
      "awaiting_responses",
      "released",
      "released",
    ]);
    expect(owner.holds).toHaveLength(6);
    // Only the owner is told what a restore left held, or the authority.
    expect(owner.authority).not.toBeNull();
    expect(list("member").holds).toEqual([]);
    expect(list("member").authority).toBeNull();
  });

  it("has a long state, an all-clear state, and a failing one", () => {
    const long = list("owner", "recovery-long");
    expect(long.holds).toHaveLength(42);
    expect(long.reviews.filter((r) => isWaitingState(r.state))).toHaveLength(3);
    expect(long.reviews).toHaveLength(13);
    expect(new Set(long.holds.map((hold) => hold.reason)).size).toBe(3);

    const clear = list("owner", "recovery-all-clear");
    expect(clear.holds).toEqual([]);
    expect(clear.reviews.every((r) => !isWaitingState(r.state))).toBe(true);

    expect(list("owner", "new-household").reviews).toEqual([]);
    const failing = read("/v1/recovery", "owner", "recovery-unavailable");
    expect(failing.status).toBe(500);
  });

  it("answers every review with the scope its reader may see", () => {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const owner = detail("owner", n);
      const member = detail("member", n);
      expect(owner.id).toBe(fixtureId(16, n));
      // A member never receives the household's roster, or anyone's claims.
      expect(member.scope.users.map((user) => user.id)).toEqual([MEMBER.id]);
      expect(member.scope.excludedUsers).toEqual([]);
      expect(member.responses.every((r) => r.userId === MEMBER.id)).toBe(true);
      expect(owner.scope.users.map((user) => user.id)).toContain(OWNER.id);
    }
  });

  it("gives review 1 a declared owner and two people still to declare, and review 5 a blocker", () => {
    const open = detail("owner", 1);
    expect(open.responses.map((row) => row.userId)).toEqual([OWNER.id]);
    expect(open.missingUserIds).toHaveLength(2);
    expect(detail("member", 1).missingUserIds).toEqual([MEMBER.id]);
    expect(detail("owner", 5).scope.blockers).not.toEqual([]);
    expect(detail("owner", 4).scope.media).toHaveLength(26);
    expect(detail("owner", 2).receiptId).not.toBeNull();
    // Review 6 has every declaration and can be applied.
    const ready = detail("owner", 6);
    expect(ready.state).toBe("awaiting_responses");
    expect(ready.missingUserIds).toEqual([]);
    expect(ready.scope.blockers).toEqual([]);
    expect(ready.responseHash).not.toBeNull();
  });

  it("answers a review that does not exist with a typed 404", () => {
    expect(
      read(`/v1/recovery/reviews/${fixtureId(16, 99)}`, "owner").status,
    ).toBe(404);
  });

  it("lists the requesters of an uploaded capture, one matched and one identity that cannot be used", () => {
    const outcome = read(
      `/v1/admin/legacy-requester-bindings?captureId=${fixtureId(17, 102)}`,
      "owner",
    );
    if (outcome.status !== 200) throw new Error("bindings were not served");
    const inventory = LegacyRequesterListSchema.parse(outcome.body);
    expect(
      inventory.requesters.map((requester) => requester.binding !== null),
    ).toEqual([false, true, false]);
    expect(inventory.targets.filter((target) => !target.eligible)).toHaveLength(
      1,
    );
    // A member may not read them.
    expect(
      read(
        `/v1/admin/legacy-requester-bindings?captureId=${fixtureId(17, 102)}`,
        "member",
      ).status,
    ).toBe(403);
  });
});
