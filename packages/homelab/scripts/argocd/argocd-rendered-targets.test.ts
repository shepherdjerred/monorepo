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

const liveCopies = [live("mc-sandbox"), live("minecraft-tsmc"), live("velero")];

describe("renderedTargetState", () => {
  test("matches a live object to the manifest rendered in its namespace", () => {
    expect(
      renderedTargetState(
        targets,
        live("mc-sandbox"),
        "mc-sandbox",
        liveCopies,
      ),
    ).toBe("role in mc-sandbox");
  });

  test("treats a live object in a namespace the revision no longer renders as a prune", () => {
    expect(
      renderedTargetState(targets, live("velero"), "mc-sandbox", liveCopies),
    ).toBeUndefined();
  });

  test("refuses a live object whose rendered namespace has no live copy yet", () => {
    expect(() =>
      renderedTargetState(targets, live("velero"), "mc-sandbox", [
        live("mc-sandbox"),
        live("velero"),
      ]),
    ).toThrow(/in namespace velero but rendered it in minecraft-tsmc/u);
  });

  test("refuses a namespace-less live object that matches several manifests", () => {
    expect(() =>
      renderedTargetState(targets, live(), "mc-sandbox", liveCopies),
    ).toThrow(/matched .* to 2 rendered manifests/u);
  });
});
