import { describe, expect, it } from "vitest";
import {
  CI_WORKSPACE_REAPER_ROLE,
  createTemporalWorkerCiWorkspaceReaperRbac,
} from "./ci-workspace-reaper-rbac.ts";
import {
  INFRA_WORKER_SUBJECT,
  renderInfraWorkerRole,
} from "./worker-rbac-test-support.ts";

describe("CI workspace reaper RBAC", () => {
  it("grants the infra worker only list and delete on CI pods and claims", () => {
    const { role, rules, binding } = renderInfraWorkerRole(
      (chart, accounts) => {
        createTemporalWorkerCiWorkspaceReaperRbac(chart, accounts);
      },
    );
    expect(role).toMatchObject({
      name: CI_WORKSPACE_REAPER_ROLE,
      namespace: "woodpecker-ci",
    });
    expect(rules).toEqual([
      {
        apiGroups: [""],
        resources: ["pods", "persistentvolumeclaims"],
        verbs: ["list", "delete"],
      },
    ]);
    expect(binding.metadata.namespace).toBe("woodpecker-ci");
    expect(binding).toMatchObject({
      roleRef: { kind: "Role", name: CI_WORKSPACE_REAPER_ROLE },
      subjects: [INFRA_WORKER_SUBJECT],
    });
  });
});
