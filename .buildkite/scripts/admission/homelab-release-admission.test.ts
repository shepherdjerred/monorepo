import { describe, expect, test } from "vitest";

import {
  decideHomelabReleaseAdmission,
  parseHomelabReleaseAdmission,
  parseOriginMainLsRemote,
  resolveOriginMainCommit,
} from "./homelab-release-admission.ts";

const buildCommit = "a".repeat(40);
const newerMainCommit = "b".repeat(40);

describe("homelab release admission", () => {
  test("admits the exact current main build", () => {
    expect(
      decideHomelabReleaseAdmission({
        buildCommit,
        currentMainCommit: buildCommit,
        buildNumber: 42,
      }),
    ).toEqual({
      schema: "homelab-release-admission/v1",
      outcome: "admitted",
      buildCommit,
      currentMainCommit: buildCommit,
      buildNumber: 42,
    });
  });

  test("records a superseded build without permitting mutation", () => {
    expect(
      decideHomelabReleaseAdmission({
        buildCommit,
        currentMainCommit: newerMainCommit,
        buildNumber: 42,
      }).outcome,
    ).toBe("superseded");
  });

  test("admits equivalent commit SHAs regardless of hex casing", () => {
    const uppercaseBuildCommit = buildCommit.toUpperCase();
    expect(
      decideHomelabReleaseAdmission({
        buildCommit: uppercaseBuildCommit,
        currentMainCommit: buildCommit,
        buildNumber: 42,
      }),
    ).toMatchObject({
      outcome: "admitted",
      buildCommit,
      currentMainCommit: buildCommit,
    });
  });

  test("rejects malformed handoffs and origin output", async () => {
    expect(() =>
      parseHomelabReleaseAdmission({ outcome: "admitted" }),
    ).toThrow();
    expect(() =>
      parseOriginMainLsRemote(`${buildCommit}\trefs/heads/other\n`),
    ).toThrow("could not resolve the exact origin/main commit");
    await expect(
      resolveOriginMainCommit("main", async () => ({
        exitCode: 2,
        stdout: "",
      })),
    ).rejects.toThrow("could not resolve origin/main");
    expect(
      parseOriginMainLsRemote(
        `${buildCommit.toUpperCase()}\trefs/heads/trunk\n`,
        "trunk",
      ),
    ).toBe(buildCommit);
  });

  test("does not invalidate an admitted handoff when main advances later", () => {
    const admitted = decideHomelabReleaseAdmission({
      buildCommit,
      currentMainCommit: buildCommit,
      buildNumber: 42,
    });
    expect(parseHomelabReleaseAdmission(admitted).outcome).toBe("admitted");
    expect(newerMainCommit).not.toBe(admitted.currentMainCommit);
  });
});
