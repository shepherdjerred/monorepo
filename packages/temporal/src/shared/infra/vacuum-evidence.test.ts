import { describe, expect, test } from "vitest";
import type { EntityState, LogbookEntry } from "@shepherdjerred/home-assistant";
import { classifyVacuumStartEvidence } from "./vacuum-evidence.ts";

const entityId = "vacuum.1st_floor";
const requestedAt = "2026-10-01T00:00:00Z";
function state(value: string, when: string, id = entityId): EntityState {
  return { entity_id: id, state: value, attributes: {}, last_changed: when };
}
const cleaning = state("cleaning", "2026-10-01T00:00:16Z");
const docked = state("docked", "2026-10-01T00:01:08Z");
const returned: LogbookEntry = {
  entity_id: entityId,
  when: "2026-10-01T00:00:20Z",
  state: "returning",
  context_event_type: "call_service",
  context_domain: "vacuum",
  context_service: "return_to_base",
};

describe("vacuum recorder evidence", () => {
  test("witnesses short cleaning followed by an explicit return without identifying its actor", () => {
    expect(
      classifyVacuumStartEvidence(entityId, requestedAt, docked, {
        history: [[cleaning, docked]],
        logbook: [returned],
      }),
    ).toEqual({ started: true, commandedReturn: true, currentState: "docked" });
  });
  test("does not count the history baseline or another vacuum as a new start", () => {
    expect(
      classifyVacuumStartEvidence(entityId, requestedAt, docked, {
        history: [
          [
            state("cleaning", "2026-09-30T23:59:59Z"),
            state("cleaning", "2026-10-01T00:00:16Z", "vacuum.2nd_floor"),
          ],
        ],
        logbook: [returned],
      }).started,
    ).toBe(false);
  });
  test("does not infer an interruption from an uncommanded return or unrelated command", () => {
    for (const logbook of [
      [],
      [{ ...returned, context_service: "start" }],
      [{ ...returned, entity_id: "vacuum.2nd_floor" }],
      [{ ...returned, when: "2026-09-30T23:59:59Z" }],
    ]) {
      expect(
        classifyVacuumStartEvidence(entityId, requestedAt, docked, {
          history: [[cleaning]],
          logbook,
        }).commandedReturn,
      ).toBe(false);
    }
  });
  test("does not count missing timestamps as recorder evidence", () => {
    expect(
      classifyVacuumStartEvidence(entityId, requestedAt, docked, {
        history: [[{ entity_id: entityId, state: "cleaning", attributes: {} }]],
        logbook: [],
      }).started,
    ).toBe(false);
  });
});
