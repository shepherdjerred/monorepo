import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import {
  HUMAN_ARGOCD_ACCOUNT,
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
async function humanMay(action: string, object: string): Promise<boolean> {
  return argoRbacAllows({
    subject: HUMAN_ARGOCD_ACCOUNT,
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

  test("disables admin and gives people one read-only login", () => {
    expect(humanArgoCdSettings(true)).toEqual({
      "admin.enabled": false,
      [`accounts.${HUMAN_ARGOCD_ACCOUNT}`]: "login",
      [`accounts.${HUMAN_ARGOCD_ACCOUNT}.enabled`]: true,
    });
  });

  test.each(["cluster/arcade", "workloads/birmel", "default/apps"])(
    "the human login reads %s",
    async (object) => {
      expect(await humanMay("get", object)).toBe(true);
    },
  );

  test.each(
    ["create", "update", "delete", "sync", "override"].flatMap((action) =>
      ["cluster/arcade", "workloads/birmel", "default/apps"].map((object) => ({
        action,
        object,
      })),
    ),
  )("the human login cannot $action $object", async ({ action, object }) => {
    expect(await humanMay(action, object)).toBe(false);
  });
});
