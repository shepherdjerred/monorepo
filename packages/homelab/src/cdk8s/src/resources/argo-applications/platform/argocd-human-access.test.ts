import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import {
  HUMAN_ARGOCD_ACCOUNT,
  HOMELAB_AUDIT_ARGOCD_ACCOUNT,
  WORKSTATION_ARGOCD_ACCOUNT,
  humanArgoCdPolicyRows,
  humanArgoCdReadOnly,
  humanArgoCdSettings,
} from "./argocd-human-access.ts";
import { deliveryArgoPolicy } from "./delivery-rbac.ts";
import {
  argoRbacAllows,
  writeOfflineKubeconfig,
} from "@shepherdjerred/homelab/cdk8s/src/testing/argocd-rbac.ts";

let directory: string;
let policyFile: string;
let kubeconfig: string;
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "human-argo-rbac-"));
  policyFile = path.join(directory, "policy.yaml");
  kubeconfig = await writeOfflineKubeconfig(directory);
  await Bun.write(
    policyFile,
    stringify({
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: { name: "argocd-rbac-cm" },
      data: {
        "policy.default": "",
        "policy.csv": [
          deliveryArgoPolicy(true),
          ...humanArgoCdPolicyRows(true),
        ].join("\n"),
      },
    }),
  );
});
afterAll(async () => {
  await rm(directory, { recursive: true });
});

/** Evaluate with ArgoCD's built-in policy, which defines `role:readonly`. */
async function accountMay(
  subject: string,
  action: string,
  object: string,
): Promise<boolean> {
  return argoRbacAllows({
    subject,
    action,
    resource: "applications",
    object,
    policyFile,
    kubeconfig,
    home: directory,
    builtinPolicy: true,
  });
}

describe("human ArgoCD access", () => {
  test("is on since the window's lock-down step", () => {
    expect(humanArgoCdReadOnly()).toBe(true);
    expect(humanArgoCdSettings()).toEqual(humanArgoCdSettings(true));
    expect(humanArgoCdPolicyRows()).toEqual(humanArgoCdPolicyRows(true));
  });

  test("changes nothing while off", () => {
    expect(humanArgoCdSettings(false)).toEqual({});
    expect(humanArgoCdPolicyRows(false)).toEqual([]);
  });

  test("disables admin and gives people one read-only login and one read-only workstation API account", () => {
    expect(humanArgoCdSettings(true)).toEqual({
      "admin.enabled": false,
      [`accounts.${HUMAN_ARGOCD_ACCOUNT}`]: "login",
      [`accounts.${HUMAN_ARGOCD_ACCOUNT}.enabled`]: true,
      [`accounts.${WORKSTATION_ARGOCD_ACCOUNT}`]: "apiKey",
      [`accounts.${WORKSTATION_ARGOCD_ACCOUNT}.enabled`]: true,
      [`accounts.${HOMELAB_AUDIT_ARGOCD_ACCOUNT}`]: "apiKey",
      [`accounts.${HOMELAB_AUDIT_ARGOCD_ACCOUNT}.enabled`]: true,
    });
    expect(humanArgoCdPolicyRows(true)).toEqual([
      `g, ${HUMAN_ARGOCD_ACCOUNT}, role:readonly`,
      `g, ${WORKSTATION_ARGOCD_ACCOUNT}, role:readonly`,
      `g, ${HOMELAB_AUDIT_ARGOCD_ACCOUNT}, role:readonly`,
    ]);
  });

  const accounts = [
    HUMAN_ARGOCD_ACCOUNT,
    WORKSTATION_ARGOCD_ACCOUNT,
    HOMELAB_AUDIT_ARGOCD_ACCOUNT,
  ];
  const objects = ["cluster/arcade", "workloads/birmel", "default/apps"];

  test.each(
    accounts.flatMap((account) =>
      objects.map((object) => ({ account, object })),
    ),
  )("$account reads $object", async ({ account, object }) => {
    expect(await accountMay(account, "get", object)).toBe(true);
  });

  test.each(
    accounts.flatMap((account) =>
      ["create", "update", "delete", "sync", "override"].flatMap((action) =>
        objects.map((object) => ({ account, action, object })),
      ),
    ),
  )("$account cannot $action $object", async ({ account, action, object }) => {
    expect(await accountMay(account, action, object)).toBe(false);
  });
});
