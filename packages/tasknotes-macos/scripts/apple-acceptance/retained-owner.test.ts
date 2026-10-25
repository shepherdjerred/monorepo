import { expect, test } from "vitest";
import {
  launchJournal,
  retireRetainedOwner,
  type LaunchJournal,
  type OwnerControls,
} from "./retained-owner.ts";

const binding = {
  runID: "d9d94418-b632-4d20-8edf-df9e502dc3df",
  descriptor: "/owned/acceptance.json",
  executable: "/owned/run/FacetAcceptance",
};
const identity = {
  uid: 501,
  ruid: 501,
  startSeconds: 100,
  startMicroseconds: 123,
};
const journal: LaunchJournal = {
  ...binding,
  schemaVersion: 1,
  launches: [{ pid: 45001, identity, state: "running" }],
};
function controls(owners: number[], observed = identity) {
  const signalled: number[] = [];
  let present = owners;
  const operations: OwnerControls = {
    inspect: async () => present,
    identity: async () => observed,
    terminate: async (pid, expected) => {
      expect(expected).toEqual(identity);
      signalled.push(pid);
      present = [];
    },
    now: () => 0,
    pause: async () => undefined,
  };
  return { operations, signalled };
}
test("only a retained launch lifetime grants retirement authority", async () => {
  const owned = controls([45001]);
  await expect(
    retireRetainedOwner(journal, binding, owned.operations),
  ).resolves.toEqual({ signalSubmitted: true, observedExit: true });
  expect(owned.signalled).toEqual([45001]);
});
test.each([
  null,
  { ...journal, launches: [] },
  {
    ...journal,
    launches: [
      {
        ...journal.launches[0],
        pid: 45001,
        identity,
        state: "closed" as const,
      },
    ],
  },
])("a missing or closed owner never adopts a replacement", async (proof) => {
  const replacement = controls([45002]);
  await expect(
    retireRetainedOwner(proof, binding, replacement.operations),
  ).rejects.toThrow();
  expect(replacement.signalled).toEqual([]);
});
test("an absent original followed by another PID is left running", async () => {
  const replacement = controls([45002]);
  await expect(
    retireRetainedOwner(journal, binding, replacement.operations),
  ).rejects.toThrow();
  expect(replacement.signalled).toEqual([]);
});
test("PID reuse is rejected at the signal boundary", async () => {
  const reused = controls([45001], { ...identity, startMicroseconds: 124 });
  await expect(
    retireRetainedOwner(journal, binding, reused.operations),
  ).rejects.toThrow("reused PID");
  expect(reused.signalled).toEqual([]);
});
test("a foreign-run or altered executable journal cannot grant authority", async () => {
  for (const foreign of [
    { ...journal, runID: "another-run" },
    { ...journal, descriptor: "/foreign/acceptance.json" },
    { ...journal, executable: "/foreign/FacetAcceptance" },
  ]) {
    const owned = controls([45001]);
    await expect(
      retireRetainedOwner(foreign, binding, owned.operations),
    ).rejects.toThrow();
    expect(owned.signalled).toEqual([]);
  }
});
test("failed launch with no process requires no signal", async () => {
  const absent = controls([]);
  await expect(
    retireRetainedOwner(null, binding, absent.operations),
  ).resolves.toEqual({ signalSubmitted: false, observedExit: true });
  expect(absent.signalled).toEqual([]);
});
test("cold launches must close each preceding identity and cannot reuse its lifetime", () => {
  const closed = {
    ...journal.launches[0],
    pid: 45001,
    identity,
    state: "closed",
  };
  expect(() =>
    launchJournal(
      {
        ...journal,
        launches: [
          closed,
          {
            pid: 45002,
            identity: { ...identity, startSeconds: 101 },
            state: "closed",
          },
        ],
      },
      binding,
    ),
  ).not.toThrow();
  expect(() =>
    launchJournal({ ...journal, launches: [closed, closed] }, binding),
  ).toThrow();
  expect(() =>
    launchJournal(
      { ...journal, launches: [journal.launches[0], closed] },
      binding,
    ),
  ).toThrow();
});
test("replacement after TERM is detected without a second signal", async () => {
  const owned = controls([45001]);
  owned.operations.terminate = async (pid) => {
    owned.signalled.push(pid);
    owned.operations.inspect = async () => [45002];
  };
  await expect(
    retireRetainedOwner(journal, binding, owned.operations),
  ).rejects.toThrow("replacement");
  expect(owned.signalled).toEqual([45001]);
});
