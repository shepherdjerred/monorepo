import { describe, expect, test } from "vitest";
import {
  allowsUnstaged,
  coverageReport,
  renderCoverage,
  type PodSummary,
} from "./coverage.ts";
import { otherPolicy, stagingPolicy } from "./fixtures.ts";

function pods(
  namespace: string,
  count: number,
  phase = "Running",
): PodSummary[] {
  return Array.from({ length: count }, () => ({
    metadata: { namespace },
    status: { phase },
  }));
}

const policies = [
  otherPolicy("argocd", "argocd-server"),
  otherPolicy("argocd", "argocd-repo-server"),
  otherPolicy("tracker", "tracker-app"),
  stagingPolicy("tracker", "open"),
  otherPolicy("media", "plex"),
  stagingPolicy("media", "enforced"),
  otherPolicy("pg18-rehearsal-bugsink", "postgres"),
  otherPolicy("ops-restore-rehearsal", "restore"),
  // Only its own staging policy: nothing else to bite, so not listed.
  stagingPolicy("redlib", "open"),
  // A staging policy named for another namespace does not stage this one.
  otherPolicy("flipt", "enforcement-staging-tracker"),
  {
    ...stagingPolicy("home", "open"),
    spec: { podSelector: { matchLabels: { app: "home" } } },
  },
  otherPolicy("home", "homeassistant"),
];

const live = [
  ...pods("argocd", 7),
  ...pods("tracker", 2),
  ...pods("media", 3),
  ...pods("media", 4, "Succeeded"),
  ...pods("pg18-rehearsal-bugsink", 1),
  ...pods("ops-restore-rehearsal", 2, "Succeeded"),
  ...pods("ops-restore-rehearsal", 1, "Failed"),
  ...pods("flipt", 1),
  ...pods("home", 5),
  ...pods("redlib", 1),
];

function summary(allow: string[] = [], running = live) {
  return coverageReport(policies, running, allow).rows.map(
    (row) =>
      `${row.namespace} ${String(row.policies)} ${String(row.pods)} ${row.stage} ${row.result}`,
  );
}

describe("coverage decision", () => {
  test("lists every namespace with a policy other than its own staging policy", () => {
    expect(summary()).toEqual([
      "argocd 2 7 none unstaged",
      "flipt 1 1 none unstaged",
      "home 1 5 unrecognized unrecognized",
      "media 1 3 enforced staged",
      "ops-restore-rehearsal 1 0 none no pods",
      "pg18-rehearsal-bugsink 1 1 none unstaged",
      "tracker 1 2 open staged",
    ]);
  });

  test("policies and a pod without a staging policy fail; zero pods do not", () => {
    expect(coverageReport(policies, live, []).ok).toBe(false);
    expect(summary([], [])).toEqual([
      "argocd 2 0 none no pods",
      "flipt 1 0 none no pods",
      "home 1 0 unrecognized unrecognized",
      "media 1 0 enforced staged",
      "ops-restore-rehearsal 1 0 none no pods",
      "pg18-rehearsal-bugsink 1 0 none no pods",
      "tracker 1 0 open staged",
    ]);
    const staged = policies.filter(
      (policy) => policy.metadata.namespace === "tracker",
    );
    expect(coverageReport(staged, live, []).ok).toBe(true);
  });

  test("an allow entry excuses a name or a prefix, never an unrecognized policy", () => {
    const allow = ["argocd", "flipt", "pg18-rehearsal-", "home"];
    expect(summary(allow)).toEqual([
      "argocd 2 7 none allowed",
      "flipt 1 1 none allowed",
      "home 1 5 unrecognized unrecognized",
      "media 1 3 enforced staged",
      "ops-restore-rehearsal 1 0 none no pods",
      "pg18-rehearsal-bugsink 1 1 none allowed",
      "tracker 1 2 open staged",
    ]);
    expect(coverageReport(policies, live, allow).ok).toBe(false);
    expect(
      coverageReport(
        policies.filter((policy) => policy.metadata.namespace !== "home"),
        live,
        ["argocd", "flipt", "pg18-rehearsal-*"],
      ).ok,
    ).toBe(true);
  });

  test("allow entries match a whole name, or a prefix ending in - or *", () => {
    expect(allowsUnstaged("argocd", ["argocd"])).toBe(true);
    expect(allowsUnstaged("argocd-extra", ["argocd"])).toBe(false);
    expect(allowsUnstaged("pg18-rehearsal-x", ["pg18-rehearsal-"])).toBe(true);
    expect(allowsUnstaged("pg18-rehearsal-x", ["pg18-*"])).toBe(true);
    expect(allowsUnstaged("pg18", ["pg18-"])).toBe(false);
    expect(allowsUnstaged("argocd", [])).toBe(false);
  });
});

describe("coverage rendering", () => {
  test("names the failing namespaces", () => {
    expect(renderCoverage(coverageReport(policies.slice(0, 4), live, []))).toBe(
      [
        "NAMESPACE  POLICIES  PODS  STAGING            RESULT",
        "argocd     2         7     no staging policy  FAIL (unstaged)",
        "tracker    1         2     open               staged",
        "",
        "FAIL: 1/2 namespaces have policies and pods but no usable staging policy: argocd",
      ].join("\n"),
    );
    expect(
      renderCoverage(coverageReport(policies.slice(2, 4), live, [])),
    ).toContain(
      "PASS: all 1 namespaces with policies are staged, empty or allowed",
    );
  });
});
