import { describe, expect, test } from "vitest";
import {
  renderedTargetState,
  resourceIdentity,
  type RenderedTarget,
} from "./argocd-rendered-targets.ts";

const GROUP = "rbac.authorization.k8s.io";

function rendered(namespace: string): RenderedTarget {
  return {
    apiVersion: `${GROUP}/v1`,
    group: GROUP,
    kind: "Role",
    manifest: `role in ${namespace}`,
    name: "mc-harness",
    namespace,
  };
}

const targets = new Map([
  [
    resourceIdentity(GROUP, "Role", "mc-harness"),
    [rendered("mc-sandbox"), rendered("minecraft-tsmc")],
  ],
]);

function live(namespace?: string) {
  return {
    group: GROUP,
    kind: "Role",
    name: "mc-harness",
    ...(namespace === undefined ? {} : { namespace }),
  };
}

describe("renderedTargetState", () => {
  test("matches a live object to the manifest rendered in its namespace", () => {
    expect(renderedTargetState(targets, live("mc-sandbox"), "mc-sandbox")).toBe(
      "role in mc-sandbox",
    );
  });

  test("treats a live object in a namespace the revision no longer renders as a prune", () => {
    expect(
      renderedTargetState(targets, live("velero"), "mc-sandbox"),
    ).toBeUndefined();
  });

  test("refuses a namespace-less live object that matches several manifests", () => {
    expect(() => renderedTargetState(targets, live(), "mc-sandbox")).toThrow(
      /matched .* to 2 rendered manifests/u,
    );
  });
});
