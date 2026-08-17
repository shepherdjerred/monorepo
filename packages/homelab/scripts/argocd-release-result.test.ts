import { expect, test } from "bun:test";

import { appliedVerifiedReleaseResult } from "./argocd-release-result.ts";

test("records applied verification separately from ArgoCD's intentional terminal state", () => {
  expect(
    appliedVerifiedReleaseResult({
      requestId: "request-id",
      revision: "2.0.0-42",
      resourceIdentities: ["v1/ConfigMap/ns/zebra", "v1/ConfigMap/ns/apps"],
      applications: [
        { name: "zebra", revision: "2.0.0-42" },
        { name: "apps", revision: "2.0.0-42" },
      ],
    }),
  ).toMatchObject({
    schema: "homelab-release-result/v1",
    outcome: "applied-verified",
    terminalOperationState: "terminated-after-applied",
    finalHealth: "all-expected-applications-synced-healthy",
    resourceIdentities: ["v1/ConfigMap/ns/apps", "v1/ConfigMap/ns/zebra"],
    applications: [
      { name: "apps", revision: "2.0.0-42" },
      { name: "zebra", revision: "2.0.0-42" },
    ],
  });
});
