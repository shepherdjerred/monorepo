import { describe, expect, test } from "vitest";
import { validProcessOwnerPacket } from "./mac-process-owner";

const identity = {
  uid: 501,
  ruid: 501,
  startSeconds: 1_800_000_000,
  startMicroseconds: 123_456,
};
const request = {
  schemaVersion: 1,
  operation: "inspect",
  pid: 12,
  executable: "/synthetic/FacetAcceptance",
  expected: null,
};
const response = {
  schemaVersion: 1,
  operation: "inspect",
  pid: 12,
  outcome: "inspected",
  identity,
  reason: null,
  signalSubmitted: false,
};

describe("neutral process-owner packets", () => {
  test("requires a complete lifetime for termination and none for inspection", () => {
    expect(validProcessOwnerPacket("request", request)).toBe(true);
    expect(
      validProcessOwnerPacket("request", {
        ...request,
        operation: "terminate",
        expected: identity,
      }),
    ).toBe(true);
    for (const invalid of [
      { ...request, expected: identity },
      { ...request, operation: "terminate" },
      { ...request, operation: "SIGKILL", expected: identity },
      {
        ...request,
        operation: "terminate",
        expected: { ...identity, uid: -1 },
      },
      {
        ...request,
        operation: "terminate",
        expected: { ...identity, ruid: false },
      },
      {
        ...request,
        operation: "terminate",
        expected: { ...identity, startSeconds: 0 },
      },
      {
        ...request,
        operation: "terminate",
        expected: { ...identity, startMicroseconds: 1_000_000 },
      },
      { ...request, pid: 0 },
      { ...request, pid: 2_147_483_648 },
      { ...request, executable: "relative/path" },
      { ...request, executable: "/synthetic/\npath" },
      { ...request, extra: "synthetic-sensitive-data" },
    ])
      expect(validProcessOwnerPacket("request", invalid)).toBe(false);
  });

  test("keeps signal submission and rejected guards mutually exclusive", () => {
    expect(validProcessOwnerPacket("response", response)).toBe(true);
    expect(
      validProcessOwnerPacket("response", {
        ...response,
        operation: "terminate",
        outcome: "signal-submitted",
        signalSubmitted: true,
      }),
    ).toBe(true);
    expect(
      validProcessOwnerPacket("response", {
        ...response,
        outcome: "rejected",
        identity: null,
        reason: "lifetime",
      }),
    ).toBe(true);
    for (const invalid of [
      {
        ...response,
        outcome: "rejected",
        reason: "lifetime",
        signalSubmitted: true,
      },
      {
        ...response,
        outcome: "signal-submitted",
        operation: "terminate",
        signalSubmitted: false,
      },
      { ...response, outcome: "signal-submitted", signalSubmitted: true },
      { ...response, identity: null },
      { ...response, reason: "synthetic-sensitive-data" },
      { ...response, extra: "synthetic-sensitive-data" },
    ])
      expect(validProcessOwnerPacket("response", invalid)).toBe(false);
  });
});
