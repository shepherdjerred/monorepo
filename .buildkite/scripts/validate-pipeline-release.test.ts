import { describe, expect, test } from "bun:test";

import {
  validateAtomicRootSyncLifecycle,
  validateVersionCommitBackInstall,
} from "./validate-pipeline-release.ts";

const argocdCommand = (subcommand: string): string =>
  `bun --no-install packages/homelab/scripts/argocd.ts ${subcommand}`;
const stagedRootRelease = argocdCommand(
  'stage-root-release apps --revision "$$apps_revision" --timeout 300',
);
const atomicRootSync = argocdCommand(
  'finalize-root-release apps --revision "$$apps_revision" --request-id "$BUILDKITE_BUILD_ID" --timeout 300',
);
const deferredReleaseHealth = argocdCommand(
  "reconcile-release argocd-release-expected.json --skip-health-wait --timeout 300",
);
const scopedReleaseHealth = argocdCommand(
  "release-health-wait argocd-release-expected.json --timeout 300",
);
const atomicLifecycle = [
  stagedRootRelease,
  deferredReleaseHealth,
  atomicRootSync,
  scopedReleaseHealth,
].join("\n");

describe("atomic ArgoCD root sync pipeline contract", () => {
  test("accepts the one-process identity-bound lifecycle", () => {
    expect(() =>
      validateAtomicRootSyncLifecycle(atomicLifecycle),
    ).not.toThrow();
  });

  test("rejects the split async and finalizer lifecycle", () => {
    const splitLifecycle = [
      atomicLifecycle,
      argocdCommand('sync apps --revision "$$apps_revision" --prune --async'),
      argocdCommand('finalize-async-sync apps --revision "$$apps_revision"'),
    ].join("\n");

    expect(() => validateAtomicRootSyncLifecycle(splitLifecycle)).toThrow(
      "argocd-sync restored the racy split async/finalize lifecycle",
    );
  });

  test("rejects an async root sync regardless of flag ordering", () => {
    const reorderedAsync = [
      atomicLifecycle,
      argocdCommand('sync apps --revision "$$apps_revision" --async --prune'),
    ].join("\n");

    expect(() => validateAtomicRootSyncLifecycle(reorderedAsync)).toThrow(
      "argocd-sync restored the racy split async/finalize lifecycle",
    );
  });

  test("rejects a pipeline without the atomic root sync", () => {
    expect(() =>
      validateAtomicRootSyncLifecycle(
        [stagedRootRelease, deferredReleaseHealth, scopedReleaseHealth].join(
          "\n",
        ),
      ),
    ).toThrow(
      "argocd-sync must contain exactly one atomic identity-bound root sync",
    );
  });

  test("rejects the full-source final sync that can stall before later waves", () => {
    const legacyFinalSync = [
      stagedRootRelease,
      deferredReleaseHealth,
      argocdCommand(
        'sync apps --revision "$$apps_revision" --prune --terminate-after-applied --request-id "$BUILDKITE_BUILD_ID" --timeout 300',
      ),
      scopedReleaseHealth,
    ].join("\n");

    expect(() => validateAtomicRootSyncLifecycle(legacyFinalSync)).toThrow(
      "argocd-sync must contain exactly one atomic identity-bound root sync",
    );
  });

  test("rejects child health before the atomic root apply", () => {
    const eagerHealth = [
      stagedRootRelease,
      argocdCommand(
        "reconcile-release argocd-release-expected.json --timeout 300",
      ),
      atomicRootSync,
      scopedReleaseHealth,
    ].join("\n");

    expect(() => validateAtomicRootSyncLifecycle(eagerHealth)).toThrow(
      "argocd-sync must contain exactly one deferred child reconciliation",
    );
  });

  test("rejects child reconciliation before root staging", () => {
    const wrongOrder = [
      deferredReleaseHealth,
      stagedRootRelease,
      atomicRootSync,
      scopedReleaseHealth,
    ].join("\n");

    expect(() => validateAtomicRootSyncLifecycle(wrongOrder)).toThrow(
      "argocd-sync must stage root, reconcile children, restore root, then run scoped health",
    );
  });

  test("rejects the legacy child-only suspension command", () => {
    const childOnlyStaging = [
      argocdCommand(
        'suspend-auto-sync apps --revision "$$apps_revision" --timeout 300',
      ),
      deferredReleaseHealth,
      atomicRootSync,
      scopedReleaseHealth,
    ].join("\n");

    expect(() => validateAtomicRootSyncLifecycle(childOnlyStaging)).toThrow(
      "argocd-sync must contain exactly one root staging command with child auto-sync suspended",
    );
  });

  test("rejects an extra eager child reconciliation", () => {
    const duplicateReconciliation = [
      argocdCommand(
        "reconcile-release argocd-release-expected.json --timeout 300",
      ),
      atomicLifecycle,
    ].join("\n");

    expect(() =>
      validateAtomicRootSyncLifecycle(duplicateReconciliation),
    ).toThrow(
      "argocd-sync must contain exactly one deferred child reconciliation",
    );
  });

  test("rejects an extra eager scoped health gate", () => {
    const duplicateHealth = [scopedReleaseHealth, atomicLifecycle].join("\n");

    expect(() => validateAtomicRootSyncLifecycle(duplicateHealth)).toThrow(
      "argocd-sync must contain exactly one scoped release health gate",
    );
  });

  test("rejects behavior-changing flags on the scoped health gate", () => {
    const dryRunHealth = [
      stagedRootRelease,
      deferredReleaseHealth,
      atomicRootSync,
      `${scopedReleaseHealth} --dry-run`,
    ].join("\n");

    expect(() => validateAtomicRootSyncLifecycle(dryRunHealth)).toThrow(
      "argocd-sync must contain exactly one scoped release health gate",
    );
  });

  test("does not treat a comment as an executable health gate", () => {
    const commentedHealth = [
      stagedRootRelease,
      deferredReleaseHealth,
      atomicRootSync,
      `# ${scopedReleaseHealth}`,
    ].join("\n");

    expect(() => validateAtomicRootSyncLifecycle(commentedHealth)).toThrow(
      "argocd-sync must contain exactly one scoped release health gate",
    );
  });

  test("rejects an eager reconciliation wrapped in shell control flow", () => {
    const wrappedReconciliation = [
      `if ${argocdCommand(
        "reconcile-release argocd-release-expected.json --timeout 300",
      )}; then :; fi`,
      atomicLifecycle,
    ].join("\n");

    expect(() =>
      validateAtomicRootSyncLifecycle(wrappedReconciliation),
    ).toThrow(
      "argocd-sync must contain exactly one deferred child reconciliation",
    );
  });

  test("rejects an eager reconciliation split across shell continuations", () => {
    const continuedReconciliation = [
      "bun --no-install \\",
      "  packages/homelab/scripts/argocd.ts reconcile-release argocd-release-expected.json --timeout 300",
      atomicLifecycle,
    ].join("\n");

    expect(() =>
      validateAtomicRootSyncLifecycle(continuedReconciliation),
    ).toThrow(
      "argocd-sync must contain exactly one deferred child reconciliation",
    );
  });
});

describe("version commit-back install contract", () => {
  const isolatedLinkerInstall =
    ".buildkite/scripts/bun-install.sh --frozen-lockfile --filter '@shepherdjerred/root-scripts' --filter '@homelab/cdk8s' --production";

  test("installs both the script and imported catalog workspaces", () => {
    expect(() =>
      validateVersionCommitBackInstall(isolatedLinkerInstall),
    ).not.toThrow();
  });

  test("rejects installing zod only for the importing scripts workspace", () => {
    expect(() =>
      validateVersionCommitBackInstall(
        ".buildkite/scripts/bun-install.sh --frozen-lockfile --filter '@shepherdjerred/root-scripts' --production",
      ),
    ).toThrow("version commit-back is missing exact isolated-linker install");
  });
});
