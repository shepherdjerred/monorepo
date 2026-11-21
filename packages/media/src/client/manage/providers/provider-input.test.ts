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
      policyCombination: "all",
      policyEvidence: "short",
      policyVerified: "on",
      policySizeRule: "on",
      policySecondsPerGiB: "3600",
      policySizeMinimum: "100",
      policySizeMaximum: "10",
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
  expect(refused.fields["policySizeMaximum"]).toBe(
    "The longest time cannot be shorter than the shortest time.",
  );
  expect(
    readProvider(
      providerForm({
        policyKind: "private",
        policyRatio: "",
        policySeconds: "",
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
    policySeconds: "604800",
    policyCombination: "all",
    policyEvidence: "Tracker rules checked for the current account",
    policyVerified: "on",
    policySizeRule: "on",
    policySecondsPerGiB: "3600",
    policySizeMinimum: "86400",
    policySizeMaximum: "1209600",
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
