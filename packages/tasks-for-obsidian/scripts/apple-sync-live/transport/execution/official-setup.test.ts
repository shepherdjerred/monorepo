import { expect, test } from "vitest";
import { parseOfficialEvalBoolean } from "./official-read.ts";
const bytes = (value: string) => new TextEncoder().encode(value);

test("official eval parses the observed CLI prefix and rejects plain or error output", () => {
  expect(parseOfficialEvalBoolean(bytes("=> true\n\n"))).toBe(true);
  expect(parseOfficialEvalBoolean(bytes("=> false\n\n"))).toBe(false);
  for (const value of [
    "true",
    "false",
    "Error: failed",
    "=> null",
    "prefix => true",
  ])
    expect(() => parseOfficialEvalBoolean(bytes(value))).toThrow();
});
import {
  requireOwnedReferenceRegistration,
  OfficialRegistrySchema,
} from "./official-registry.ts";
import { parseOfficialAccountArguments } from "./official-host.ts";
import {
  OfficialProbeIdentitySchema,
  requireOfficialProbe,
} from "./official-proof.ts";
import {
  ExecutionOperationSchema,
  OfficialAccountReceiptSchema,
} from "./contract.ts";
const run = "088157c5-d48e-4581-abfc-d8b17d3a6f71";
test("saved input readiness rejects stale run/config/helper pins, uncleared fields and any submission", () => {
  const identity = OfficialProbeIdentitySchema.parse({
    runID: run,
    guestConfigSHA256: "a".repeat(64),
    sourceHead: "b".repeat(40),
    mainSourceSHA256: "c".repeat(64),
    ownerSourceSHA256: "d".repeat(64),
  });
  const receipt = {
    ready: true,
    pid: 1,
    startSeconds: 1,
    startMicroseconds: 0,
    launchDate: 1,
    secureField: true,
    submitActionCount: 0,
    loginEnabled: true,
    emailLength: 32,
    passwordLength: 38,
    focusedSecureField: true,
    cleared: true,
  };
  const proof = {
    schemaVersion: 1,
    kind: "official-private-input-probe",
    identity,
    binarySHA256: "e".repeat(64),
    receipt,
  };
  expect(() => requireOfficialProbe(proof, identity)).not.toThrow();
  for (const changed of [
    { ...identity, runID: crypto.randomUUID() },
    { ...identity, guestConfigSHA256: "f".repeat(64) },
    { ...identity, mainSourceSHA256: "f".repeat(64) },
    { ...identity, ownerSourceSHA256: "f".repeat(64) },
  ])
    expect(() => requireOfficialProbe(proof, changed)).toThrow();
  for (const changed of [
    { ...receipt, cleared: false },
    { ...receipt, submitActionCount: 1 },
    { ...receipt, focusedSecureField: false },
    { ...receipt, passwordLength: 0 },
  ])
    expect(() =>
      requireOfficialProbe({ ...proof, receipt: changed }, identity),
    ).toThrow();
});
test("official registration accepts only owned observation or live reference roots and exact schema", () => {
  const root = "/owned/packages/tasks-for-obsidian",
    home = "/Users/admin";
  for (const directory of [
    `${root}/.build/live-sync/${run}/reference-vault`,
    `${home}/Library/Application Support/FacetAcceptanceHarness/Observations/${run}/reference-vault`,
  ])
    expect(() =>
      requireOwnedReferenceRegistration(directory, root, home),
    ).not.toThrow();
  for (const directory of [
    `${home}/Documents/Personal`,
    `${root}/.build/live-sync/${run}/../reference-vault`,
    `${root}/.build/live-sync/not-a-run/reference-vault`,
  ])
    expect(() =>
      requireOwnedReferenceRegistration(directory, root, home),
    ).toThrow();
  expect(() =>
    OfficialRegistrySchema.parse({
      cli: true,
      vaults: {},
      account: "forbidden",
    }),
  ).toThrow();
  expect(() =>
    OfficialRegistrySchema.parse({ cli: false, vaults: {} }),
  ).toThrow();
});
test("official operator requires exact credential locators and explicit plugin identity before any side effect", () => {
  expect(parseOfficialAccountArguments([run, "present"]).operation).toBe(
    "present",
  );
  expect(
    parseOfficialAccountArguments([run, "plugin", "--plugin-export", run])
      .operation,
  ).toBe("plugin");
  for (const args of [
    [run, "credentials"],
    [run, "probe", "--item", "a".repeat(26)],
    [run, "plugin", "--plugin-export", "wrong"],
    [run, "present", "--item", "a".repeat(26)],
  ])
    expect(() => parseOfficialAccountArguments(args)).toThrow();
});
test("official private input is closed and distinct from Facet enabled-state contract", () => {
  expect(() =>
    ExecutionOperationSchema.parse({
      kind: "official-account",
      action: { mode: "inspect", password: "forbidden" },
    }),
  ).toThrow();
  expect(() =>
    ExecutionOperationSchema.parse({
      kind: "official-account",
      action: { mode: "probe", email: "forbidden" },
    }),
  ).toThrow();
  expect(() =>
    OfficialAccountReceiptSchema.parse({
      ready: true,
      pid: 1,
      startSeconds: 1,
      startMicroseconds: 0,
      launchDate: 1,
      secureField: true,
      submitActionCount: 0,
      loginEnabled: true,
      password: "forbidden",
    }),
  ).toThrow();
});
