import { describe, expect, test } from "vitest";
import {
  offlineFindings,
  repositoryForPin,
  selectWorkflowPins,
  type WorkflowPin,
} from "./verify-worker-image-build-ids.ts";

const DIGEST_A =
  "sha256:839757bc2a1ffbdca5111843e6e78ea41771b6c73d486111ee993e2fda762fb5";
const DIGEST_B =
  "sha256:7dcdccbfe094f8df5e0fa83809e7eeda3f6f43d2e70584b4a5207765fbb73dae";
const SHA_A = "f23505a7251c5029e01d8157e31800e89cec8298";
const SHA_B = "3f9be51c423913df72836501a6f2602e4d52b07b";

function pin(overrides: Partial<WorkflowPin> = {}): WorkflowPin {
  return {
    name: "shepherdjerred/temporal-worker/workflows/stable",
    version: "2.0.0-13290",
    digest: DIGEST_A,
    repository: "shepherdjerred/temporal-worker",
    recordedGitSha: SHA_A,
    ...overrides,
  };
}

describe("repositoryForPin", () => {
  test("strips the workflow track", () => {
    expect(
      repositoryForPin("shepherdjerred/temporal-worker/workflows/stable"),
    ).toBe("shepherdjerred/temporal-worker");
  });

  test("strips the Scout stage, which is not part of the repository", () => {
    // Both stages publish to one repository; the stage lives in the pin name.
    for (const stage of ["beta", "prod"]) {
      expect(
        repositoryForPin(
          `shepherdjerred/scout-for-lol/${stage}/workflows/candidate`,
        ),
      ).toBe("shepherdjerred/scout-for-lol");
    }
  });
});

describe("selectWorkflowPins", () => {
  const catalog = {
    entries: [
      {
        name: "shepherdjerred/temporal-worker",
        value: `2.0.0-13290@${DIGEST_A}`,
      },
      {
        name: "shepherdjerred/temporal-worker/workflows/stable",
        value: `2.0.0-13290@${DIGEST_A}`,
      },
      { name: "some/other-service", value: `1.2.3-4@${DIGEST_B}` },
    ],
  };

  test("selects only pins that join a Worker Deployment", () => {
    const selected = selectWorkflowPins(catalog, {});
    // The bare worker image is Activity-only: its Build ID routes nothing.
    expect(selected.map((entry) => entry.name)).toEqual([
      "shepherdjerred/temporal-worker/workflows/stable",
    ]);
    expect(selected[0]?.version).toBe("2.0.0-13290");
    expect(selected[0]?.digest).toBe(DIGEST_A);
  });

  test("carries the recorded commit through when one exists", () => {
    const [selected] = selectWorkflowPins(catalog, {
      "shepherdjerred/temporal-worker/workflows/stable": { gitSha: SHA_A },
    });
    expect(selected?.recordedGitSha).toBe(SHA_A);
  });
});

describe("offlineFindings", () => {
  const state = {
    "shepherdjerred/temporal-worker/workflows/stable": {
      version: "2.0.0-13290",
      digest: DIGEST_A,
      buildNumber: 13_290,
    },
  };

  test("accepts a coherent pin", () => {
    expect(offlineFindings([pin()], state)).toEqual([]);
  });

  test("catches a catalog digest the pin state disagrees with", () => {
    const findings = offlineFindings([pin({ digest: DIGEST_B })], state);
    expect(findings.join("\n")).toContain("catalog digest");
  });

  test("catches a version that does not match its build number", () => {
    const findings = offlineFindings([pin({ version: "2.0.0-13000" })], {
      "shepherdjerred/temporal-worker/workflows/stable": {
        version: "2.0.0-13000",
        digest: DIGEST_A,
        buildNumber: 13_290,
      },
    });
    expect(findings.join("\n")).toContain("does not match buildNumber");
  });

  test("catches one image recorded against two different commits", () => {
    // This is the outage, offline: `2.0.0-13000` was believed to be c42ee297
    // while the image is built from 3f9be51c. Build numbers do not order with
    // commits, so nothing else would have contradicted it.
    const findings = offlineFindings(
      [
        pin(),
        pin({
          name: "shepherdjerred/temporal-worker/workflows/candidate",
          recordedGitSha: SHA_B,
        }),
      ],
      state,
    );
    expect(findings.join("\n")).toContain("recorded against multiple commits");
  });

  test("rejects a malformed commit", () => {
    const findings = offlineFindings(
      [pin({ recordedGitSha: "F23505A7" })],
      state,
    );
    expect(findings.join("\n")).toContain("40-character lowercase commit");
  });

  test("stays quiet for a pin the state does not record yet", () => {
    expect(offlineFindings([pin({ recordedGitSha: undefined })], {})).toEqual(
      [],
    );
  });
});
