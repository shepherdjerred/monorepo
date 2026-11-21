import { test, expect } from "vitest";
import { ProviderStatusSchema } from "#shared/admin.ts";
import { readProvider, readSeedingPolicy } from "./provider-input.ts";

const tracker = ProviderStatusSchema.parse({
  id: "avistaz",
  kind: "tracker",
  enabled: true,
  configured: true,
  credentialConfigured: true,
  configuration: {
    minimumIntervalSeconds: 30,
    dailyDownloadLimit: 10,
    selection: {
      priority: 1,
      minimumSeeders: 1,
      delaySeconds: 0,
      bypassAtHighestQuality: false,
    },
  },
  seedingPolicy: { kind: "unknown" },
  updatedAt: "2026-11-01T00:00:00.000Z",
  lastError: null,
  nextAllowedAt: null,
  feedState: "current",
  lastFeedAt: null,
});

function providerForm(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    enabled: "on",
    minimumIntervalSeconds: "45",
    minimumIntervalSecondsUnit: "seconds",
    dailyDownloadLimit: "10",
    policyKind: "unknown",
    ...fields,
  }))
    form.set(key, value);
  return form;
}

test("a provider's form becomes the body the API accepts, keeping what it does not show", () => {
  expect(readProvider(providerForm({}), tracker)).toEqual({
    ok: true,
    input: {
      expectedUpdatedAt: "2026-11-01T00:00:00.000Z",
      enabled: true,
      configuration: {
        minimumIntervalSeconds: 45,
        dailyDownloadLimit: 10,
        selection: tracker.configuration.selection,
      },
      seedingPolicy: { kind: "unknown" },
    },
  });
  const replaced = readProvider(
    providerForm({
      replaceCredential: "on",
      "credential.username": "robin",
      "credential.password": "secret",
      "credential.pid": "abc",
    }),
    tracker,
  );
  expect(replaced.ok && replaced.input.credential).toEqual({
    username: "robin",
    password: "secret",
    pid: "abc",
  });
});

test("what the schema refuses is placed on the control it came from", () => {
  const refused = readProvider(
    providerForm({
      minimumIntervalSeconds: "0",
      policyKind: "private",
      policyRatio: "",
      policySeconds: "",
      policySecondsUnit: "days",
      policyCombination: "all",
      policyEvidence: "short",
      policyVerified: "on",
      policySizeRule: "on",
      policySecondsPerGiB: "1",
      policySecondsPerGiBUnit: "hours",
      policySizeMinimum: "100",
      policySizeMinimumUnit: "minutes",
      policySizeMaximum: "10",
      policySizeMaximumUnit: "minutes",
    }),
    tracker,
  );
  if (refused.ok) throw new Error("The form was accepted");
  expect(refused.other).toBe(false);
  expect(Object.keys(refused.fields).toSorted()).toEqual([
    "minimumIntervalSeconds",
    "policyEvidence",
    "policySizeMaximum",
  ]);
  expect(refused.fields).toMatchObject({
    minimumIntervalSeconds: "Enter 1 second or more.",
    policySizeMaximum:
      "The longest time cannot be shorter than the shortest time.",
  });
  expect(
    readProvider(
      providerForm({
        policyKind: "private",
        policyRatio: "",
        policySeconds: "",
        policySecondsUnit: "days",
        policyCombination: "all",
        policyEvidence: "Rules page, checked today.",
        policyVerified: "on",
      }),
      tracker,
    ),
  ).toEqual({
    ok: false,
    other: false,
    fields: {
      policyVerified:
        "Rules you have checked need a ratio, a minimum time, or a size-based time.",
    },
  });
});

test("typed private inputs preserve ratio/time combination and verified evidence", () => {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    policyKind: "private",
    policyRatio: "1.5",
    policySeconds: "7",
    policySecondsUnit: "days",
    policyCombination: "all",
    policyEvidence: "Tracker rules checked for the current account",
    policyVerified: "on",
    policySizeRule: "on",
    policySecondsPerGiB: "60",
    policySecondsPerGiBUnit: "minutes",
    policySizeMinimum: "24",
    policySizeMinimumUnit: "hours",
    policySizeMaximum: "1209600",
    policySizeMaximumUnit: "seconds",
  }))
    form.set(key, value);
  expect(readSeedingPolicy(form)).toEqual({
    kind: "private",
    verified: true,
    evidence: "Tracker rules checked for the current account",
    ratio: 1.5,
    minimumSeconds: 604_800,
    combination: "all",
    sizeRule: {
      secondsPerGiB: 3600,
      minimumSeconds: 86_400,
      maximumSeconds: 1_209_600,
    },
  });
  form.set("policySizeMaximum", "1");
  expect(() => readSeedingPolicy(form)).toThrow();
});

test("a time that is not a whole number of seconds is refused on its own control, in its own words", () => {
  const refused = readProvider(
    providerForm({
      minimumIntervalSeconds: "0.01",
      minimumIntervalSecondsUnit: "minutes",
      policyKind: "private",
      policyRatio: "1",
      policySeconds: "1.00001",
      policySecondsUnit: "days",
      policyCombination: "any",
      policyEvidence: "Rules page, checked today.",
      policyVerified: "on",
      policySizeRule: "on",
      // The one time the API takes fractions of a second for.
      policySecondsPerGiB: "0.5",
      policySecondsPerGiBUnit: "seconds",
      policySizeMinimum: "0",
      policySizeMinimumUnit: "hours",
      policySizeMaximum: "",
      policySizeMaximumUnit: "days",
    }),
    tracker,
  );
  expect(refused).toEqual({
    ok: false,
    other: false,
    fields: {
      minimumIntervalSeconds:
        "Enter a whole number of seconds. 0.01 minutes is 0.6 seconds.",
      policySeconds:
        "Enter a whole number of seconds. 1.00001 days is 86400.864 seconds.",
    },
  });
  const accepted = readProvider(
    providerForm({
      minimumIntervalSeconds: "1.5",
      minimumIntervalSecondsUnit: "minutes",
      policyKind: "private",
      policyRatio: "1",
      policySeconds: "1.5",
      policySecondsUnit: "days",
      policyCombination: "any",
      policyEvidence: "Rules page, checked today.",
      policyVerified: "on",
      policySizeRule: "on",
      policySecondsPerGiB: "0.5",
      policySecondsPerGiBUnit: "seconds",
      policySizeMinimum: "0",
      policySizeMinimumUnit: "hours",
      policySizeMaximum: "",
      policySizeMaximumUnit: "days",
    }),
    tracker,
  );
  expect(accepted.ok && accepted.input).toMatchObject({
    configuration: { minimumIntervalSeconds: 90 },
    seedingPolicy: {
      minimumSeconds: 129_600,
      sizeRule: { secondsPerGiB: 0.5, minimumSeconds: 0, maximumSeconds: null },
    },
  });
});
test("unknown policy needs no hidden private values; unchecked verification cannot authorize cleanup", () => {
  const form = new FormData();
  form.set("policyKind", "unknown");
  expect(readSeedingPolicy(form)).toEqual({ kind: "unknown" });
  for (const [key, value] of Object.entries({
    policyKind: "privatehd",
    policyRatio: "",
    policyEvidence: "Awaiting confirmation of tracker rules",
  }))
    form.set(key, value);
  expect(readSeedingPolicy(form)).toMatchObject({
    kind: "privatehd",
    ratio: null,
    verified: false,
  });
});
