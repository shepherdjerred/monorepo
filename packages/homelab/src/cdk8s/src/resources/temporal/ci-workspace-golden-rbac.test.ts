import { describe, expect, it } from "vitest";
import {
  CI_WORKSPACE_GOLDEN_ROLE,
  createTemporalWorkerCiWorkspaceGoldenRbac,
} from "./ci-workspace-golden-rbac.ts";
import {
  INFRA_WORKER_SUBJECT,
  renderInfraWorkerRole,
} from "./worker-rbac-test-support.ts";

describe("CI workspace golden RBAC", () => {
  it("lets the infra worker manage golden snapshots and only its clone parameter", () => {
    const { role, rules, binding } = renderInfraWorkerRole(
      (chart, accounts) => {
        createTemporalWorkerCiWorkspaceGoldenRbac(chart, accounts);
      },
    );
    expect(role).toMatchObject({
      name: CI_WORKSPACE_GOLDEN_ROLE,
      namespace: "woodpecker-ci",
    });
    expect(rules).toEqual([
      {
        apiGroups: ["snapshot.storage.k8s.io"],
        resources: ["volumesnapshots"],
        verbs: ["create", "get", "list", "delete"],
      },
      { apiGroups: [""], resources: ["configmaps"], verbs: ["create"] },
      {
        apiGroups: [""],
        resources: ["configmaps"],
        resourceNames: ["ci-workspace-golden"],
        verbs: ["get", "update"],
      },
      {
        apiGroups: [""],
        resources: ["persistentvolumeclaims"],
        resourceNames: ["woodpecker-workspace-golden"],
        verbs: ["get"],
      },
    ]);
    expect(binding.metadata.namespace).toBe("woodpecker-ci");
    expect(binding).toMatchObject({
      roleRef: { kind: "Role", name: CI_WORKSPACE_GOLDEN_ROLE },
      subjects: [INFRA_WORKER_SUBJECT],
    });
  });
});
