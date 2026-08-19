import { describe, expect, test } from "bun:test";

import {
  validateAtomicRootSyncLifecycle,
  validateHomelabReleaseAdmission,
  validateVersionCommitBackInstall,
} from "./validate-pipeline-release.ts";

const argocdCommand = (subcommand: string): string =>
  `bun --no-install packages/homelab/scripts/argocd.ts ${subcommand}`;
const releaseRoot = argocdCommand(
  'release-root apps argocd-release-expected.json --revision "$$apps_revision" --request-id "$BUILDKITE_BUILD_ID" --timeout 300',
);

describe("atomic ArgoCD root sync pipeline contract", () => {
  test("accepts one identity-bound release command", () => {
    expect(() => validateAtomicRootSyncLifecycle(releaseRoot)).not.toThrow();
  });

  test("rejects the split root lifecycle", () => {
    const splitLifecycle = [
      argocdCommand(
        'stage-root-release apps --revision "$$apps_revision" --timeout 300',
      ),
      argocdCommand(
        "reconcile-release argocd-release-expected.json --skip-health-wait --timeout 300",
      ),
      argocdCommand(
        'finalize-root-release apps --revision "$$apps_revision" --request-id "$BUILDKITE_BUILD_ID" --timeout 300',
      ),
      argocdCommand(
        "release-health-wait argocd-release-expected.json --timeout 300",
      ),
    ].join("\n");

    expect(() => validateAtomicRootSyncLifecycle(splitLifecycle)).toThrow(
      "argocd-sync must contain exactly one identity-bound release-root command",
    );
  });

  test("rejects a duplicate root command", () => {
    expect(() =>
      validateAtomicRootSyncLifecycle([releaseRoot, releaseRoot].join("\n")),
    ).toThrow(
      "argocd-sync must contain exactly one identity-bound release-root command",
    );
  });

  test("rejects any additional argocd.ts invocation", () => {
    expect(() =>
      validateAtomicRootSyncLifecycle(
        [
          releaseRoot,
          argocdCommand("suspend-auto-sync apps --timeout 300"),
        ].join("\n"),
      ),
    ).toThrow(
      "argocd-sync must contain exactly one identity-bound release-root command",
    );
  });

  test("ignores comments but rejects behavior-changing flags", () => {
    expect(() => validateAtomicRootSyncLifecycle(`# ${releaseRoot}`)).toThrow(
      "argocd-sync must contain exactly one identity-bound release-root command",
    );
    expect(() =>
      validateAtomicRootSyncLifecycle(`${releaseRoot} --dry-run`),
    ).toThrow(
      "argocd-sync must contain exactly one identity-bound release-root command",
    );
  });
});

describe("version commit-back install contract", () => {
  const isolatedLinkerInstall =
    ".buildkite/scripts/bun-install.sh --frozen-lockfile --filter '@shepherdjerred/root-scripts' --production";

  test("installs the script and its workspace dependency closure", () => {
    expect(() =>
      validateVersionCommitBackInstall(isolatedLinkerInstall),
    ).not.toThrow();
  });

  test("rejects installs that omit the root-scripts owner", () => {
    expect(() =>
      validateVersionCommitBackInstall(
        ".buildkite/scripts/bun-install.sh --frozen-lockfile --filter '@shepherdjerred/version-catalog' --production",
      ),
    ).toThrow("version commit-back is missing exact isolated-linker install");
  });
});

describe("homelab release admission pipeline contract", () => {
  const admittedStep = `
depends_on: verify
bun --no-install .buildkite/scripts/homelab-release-admission.ts admit
`;
  const mutatingStep = `
depends_on: [homelab-release-admission]
release_admission=$$(bun --no-install .buildkite/scripts/homelab-release-admission.ts consume)
if [ "$$release_admission" = "superseded" ]; then exit 0; fi
if [ "$$release_admission" != "admitted" ]; then exit 1; fi
`;

  function releaseSteps(): Map<string, string> {
    return new Map([
      ["homelab-release-admission", admittedStep],
      ["helm-push", mutatingStep],
      ["tofu-apply", mutatingStep],
      ["tofu-github", mutatingStep],
      [
        "argocd-sync",
        `${mutatingStep}\nbuildkite-agent artifact upload "homelab-release-result.json"`,
      ],
      ["tofu-cloudflare", mutatingStep],
    ]);
  }

  test("requires the handoff in every mutable homelab lane", () => {
    expect(() => validateHomelabReleaseAdmission(releaseSteps())).not.toThrow();
  });

  test("rejects a mutable lane that can bypass admission", () => {
    const steps = releaseSteps();
    steps.set("tofu-cloudflare", "depends_on: argocd-sync");
    expect(() => validateHomelabReleaseAdmission(steps)).toThrow(
      "tofu-cloudflare is missing homelab release admission invariant",
    );
  });
});
