import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";
import { admissionGate } from "#src/pipeline/lanes/release.ts";
import { buildPipelineSteps } from "#src/pipeline/steps.ts";
import { TEST_IMAGES } from "./identity.ts";

test.each([
  "scout-beta-release",
  "scout-tag-release",
  "scout-prod-reconcile",
  "version-commit-back",
])(
  "%s checks admission before consuming or publishing release state",
  (key) => {
    const step = buildPipelineSteps({
      images: TEST_IMAGES,
      changedBase: "base",
    }).find((entry) => entry.key === key);
    expect(step).toBeDefined();
    const commands = step?.commands ?? [];
    const admission = commands.indexOf(
      'release_admission="$(bun --no-install scripts/ci/homelab-release-admission.ts consume)"',
    );
    expect(admission).toBeGreaterThanOrEqual(0);
    for (const [index, command] of commands.entries()) {
      if (
        command.includes("read-ci-handoff.ts") ||
        command.includes("read-optional-ci-handoff.ts") ||
        command.includes("scripts/release/")
      )
        expect(index).toBeGreaterThan(admission);
    }
    expect(
      step?.secrets?.some(
        (secret) => secret.env === "SEAWEEDFS_HANDOFF_ACCESS_KEY_ID",
      ),
    ).toBe(true);
  },
);

test.each([
  ["superseded", 0, ""],
  ["admitted", 0, "consumed\n"],
  ["invalid", 1, ""],
] as const)(
  "admission %s controls downstream artifact consumption",
  (verdict, status, stdout) => {
    const result = spawnSync(
      "bash",
      [
        "-euo",
        "pipefail",
        "-c",
        [
          String.raw`bun() { printf '%s\n' '${verdict}'; }`,
          ...admissionGate("true"),
          String.raw`printf 'consumed\n'`,
        ].join("\n"),
      ],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(status);
    expect(result.stdout).toBe(stdout);
  },
);

test("an admitted release still fails if its required artifact is missing", () => {
  const result = spawnSync(
    "bash",
    [
      "-euo",
      "pipefail",
      "-c",
      [
        String.raw`bun() { printf 'admitted\n'; }`,
        ...admissionGate("true"),
        "false",
        String.raw`printf 'published\n'`,
      ].join("\n"),
    ],
    { encoding: "utf8" },
  );
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
});
