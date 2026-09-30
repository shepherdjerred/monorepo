import { expect, test } from "vitest";

import {
  appliedVerifiedReleaseResult,
  supersededReleaseResult,
} from "./argocd-release-result.ts";

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
    finalHealth: "all-expected-child-applications-synced-healthy",
    resourceIdentities: ["v1/ConfigMap/ns/apps", "v1/ConfigMap/ns/zebra"],
    applications: [
      { name: "apps", revision: "2.0.0-42" },
      { name: "zebra", revision: "2.0.0-42" },
    ],
  });
});

test("records a superseded release without claiming it applied anything", () => {
  expect(
    supersededReleaseResult({
      requestId: "request-id",
      revision: "2.0.0-42",
      supersededBy: "2.0.0-43",
    }),
  ).toEqual({
    schema: "homelab-release-result/v1",
    outcome: "superseded",
    rootApplication: "apps",
    requestId: "request-id",
    revision: "2.0.0-42",
    supersededBy: "2.0.0-43",
  });
});
