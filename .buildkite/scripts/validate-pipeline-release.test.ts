import { describe, expect, test } from "bun:test";

import { validateAtomicRootSyncLifecycle } from "./validate-pipeline-release.ts";

const atomicRootSync =
  'sync apps --revision "$$apps_revision" --prune --terminate-after-applied --request-id "$BUILDKITE_BUILD_ID" --timeout 300';

describe("atomic ArgoCD root sync pipeline contract", () => {
  test("accepts the one-process identity-bound lifecycle", () => {
    expect(() => validateAtomicRootSyncLifecycle(atomicRootSync)).not.toThrow();
  });

  test("rejects the split async and finalizer lifecycle", () => {
    const splitLifecycle = [
      atomicRootSync,
      'sync apps --revision "$$apps_revision" --prune --async',
      'finalize-async-sync apps --revision "$$apps_revision"',
    ].join("\n");

    expect(() => validateAtomicRootSyncLifecycle(splitLifecycle)).toThrow(
      "argocd-sync restored the racy split async/finalize lifecycle",
    );
  });

  test("rejects a pipeline without the atomic root sync", () => {
    expect(() =>
      validateAtomicRootSyncLifecycle("release-health-wait"),
    ).toThrow("argocd-sync is missing the atomic identity-bound root sync");
  });
});
