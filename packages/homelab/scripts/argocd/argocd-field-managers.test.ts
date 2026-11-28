import { describe, expect, test } from "vitest";
import {
  resourceUsesServerSideApply,
  staleFieldManagerFindings,
  staleFieldManagerResourceFindings,
} from "./argocd-field-managers.ts";

const IDENTITY = "apps/Deployment media/media-qbittorrent";

function owns(...entries: readonly string[]) {
  return Object.fromEntries(
    entries.map((entry) => [`k:${JSON.stringify({ name: entry })}`, {}]),
  );
}

function podTemplate(fields: Record<string, unknown>) {
  return { "f:spec": { "f:template": { "f:spec": fields } } };
}

function deployment(spec: Record<string, unknown>, managedFields: unknown[]) {
  return {
    metadata: { name: "media-qbittorrent", managedFields },
    spec: { template: { spec } },
  };
}

// The live media Deployment on 2026-11-26: Argo's server-side apply and a
// manual `kubectl patch` both own containers[gluetun].
const liveMedia = deployment(
  {
    containers: [
      { name: "gluetun" },
      { name: "qbittorrent" },
      { name: "qbittorrent-exporter" },
    ],
    initContainers: [{ name: "qbittorrent-config-seed" }],
  },
  [
    {
      manager: "argocd-controller",
      operation: "Apply",
      time: "2026-11-26T06:20:30Z",
      fieldsV1: podTemplate({
        "f:containers": owns("gluetun", "qbittorrent", "qbittorrent-exporter"),
        "f:initContainers": owns("qbittorrent-config-seed"),
      }),
    },
    {
      manager: "kubectl-patch",
      operation: "Update",
      time: "2026-11-26T05:01:32Z",
      fieldsV1: {
        "f:spec": {
          "f:replicas": {},
          "f:template": { "f:spec": { "f:containers": owns("gluetun") } },
        },
      },
    },
    {
      manager: "kube-controller-manager",
      operation: "Update",
      subresource: "status",
      time: "2026-11-26T05:01:48Z",
      fieldsV1: podTemplate({ "f:containers": owns("ignored") }),
    },
  ],
);

// #5175's chart: gluetun becomes a restartable init container.
const targetMedia = deployment(
  {
    containers: [{ name: "qbittorrent" }, { name: "qbittorrent-exporter" }],
    initContainers: [{ name: "qbittorrent-config-seed" }, { name: "gluetun" }],
  },
  [],
);

describe("stale field managers", () => {
  test("refuses the move a manual kubectl patch still co-owns", () => {
    expect(staleFieldManagerFindings(liveMedia, targetMedia, IDENTITY)).toEqual(
      [
        `${IDENTITY} drops /spec/template/spec/containers/[name=gluetun], which field manager kubectl-patch (Update at 2026-11-26T05:01:32Z) still co-owns; server-side apply keeps a co-owned entry, so clear that manager first (/how-to/clear-a-stale-field-manager/)`,
      ],
    );
  });

  test("passes once the stale manager is cleared", () => {
    const cleared = structuredClone(liveMedia);
    cleared.metadata.managedFields.splice(1, 1);
    expect(staleFieldManagerFindings(cleared, targetMedia, IDENTITY)).toEqual(
      [],
    );
  });

  test("ignores foreign owners of entries the target still declares", () => {
    const kept = deployment({ containers: [{ name: "gluetun" }] }, []);
    expect(staleFieldManagerFindings(liveMedia, kept, IDENTITY)).toEqual([]);
  });

  test("flags a dropped volume Argo's pre-server-side manager owns", () => {
    const live = deployment(
      { volumes: [{ name: "configmap-qbittorrent-config" }] },
      [
        {
          manager: "argocd-application-controller",
          operation: "Update",
          time: "2026-08-17T04:09:19Z",
          fieldsV1: podTemplate({
            "f:volumes": owns("configmap-qbittorrent-config"),
          }),
        },
      ],
    );
    const target = deployment(
      { volumes: [{ name: "configmap-qbittorrent-config-v53" }] },
      [],
    );
    expect(staleFieldManagerFindings(live, target, IDENTITY)).toEqual([
      expect.stringContaining(
        "drops /spec/template/spec/volumes/[name=configmap-qbittorrent-config], which field manager argocd-application-controller (Update at 2026-08-17T04:09:19Z)",
      ),
    ]);
  });

  test("finds pod lists nested under a CronJob's job template", () => {
    const live = {
      metadata: {
        managedFields: [
          {
            manager: "kubectl-edit",
            operation: "Update",
            time: "2026-11-01T00:00:00Z",
            fieldsV1: {
              "f:spec": {
                "f:jobTemplate": {
                  "f:spec": {
                    "f:template": {
                      "f:spec": { "f:containers": owns("debug") },
                    },
                  },
                },
              },
            },
          },
        ],
      },
    };
    const target = {
      spec: {
        jobTemplate: {
          spec: { template: { spec: { containers: [{ name: "main" }] } } },
        },
      },
    };
    expect(
      staleFieldManagerFindings(live, target, "batch/CronJob x/y"),
    ).toEqual([
      expect.stringContaining(
        "drops /spec/jobTemplate/spec/template/spec/containers/[name=debug], which field manager kubectl-edit",
      ),
    ]);
  });

  test("does not descend into fields inside a list entry", () => {
    const live = deployment({ containers: [{ name: "app" }] }, [
      {
        manager: "kubectl-patch",
        operation: "Update",
        fieldsV1: podTemplate({
          "f:containers": {
            'k:{"name":"app"}': { "f:env": owns("REMOVED") },
          },
        }),
      },
    ]);
    const target = deployment({ containers: [{ name: "app" }] }, []);
    expect(staleFieldManagerFindings(live, target, IDENTITY)).toEqual([]);
  });

  test("a live object without managed fields has nothing to report", () => {
    expect(
      staleFieldManagerFindings({ spec: {} }, targetMedia, IDENTITY),
    ).toEqual([]);
  });
});

function annotated(options: string) {
  return {
    metadata: {
      annotations: { "argocd.argoproj.io/sync-options": options },
    },
  };
}

describe("server-side apply scope", () => {
  test("follows the Application unless the resource overrides it", () => {
    expect(resourceUsesServerSideApply({}, true)).toBe(true);
    expect(resourceUsesServerSideApply({}, false)).toBe(false);
    expect(
      resourceUsesServerSideApply(annotated("ServerSideApply=true"), false),
    ).toBe(true);
    expect(
      resourceUsesServerSideApply(
        annotated("Prune=false, ServerSideApply=false"),
        true,
      ),
    ).toBe(false);
  });
});

describe("an Application's revision-scoped resources", () => {
  const resource = {
    group: "apps",
    kind: "Deployment",
    namespace: "media",
    name: "media-qbittorrent",
    liveState: JSON.stringify(liveMedia),
    targetState: JSON.stringify(targetMedia),
  };

  test("reports the stale manager for a server-side apply Application", () => {
    expect(staleFieldManagerResourceFindings([resource], true)).toEqual([
      expect.stringContaining("field manager kubectl-patch"),
    ]);
  });

  test("leaves client-side apply alone, which removes the entry itself", () => {
    expect(staleFieldManagerResourceFindings([resource], false)).toEqual([]);
  });

  test("skips a resource Argo replaces instead of applying", () => {
    const replaced = {
      ...resource,
      targetState: JSON.stringify({
        ...targetMedia,
        metadata: {
          ...targetMedia.metadata,
          annotations: {
            "argocd.argoproj.io/sync-options": "Force=true,Replace=true",
          },
        },
      }),
    };
    expect(staleFieldManagerResourceFindings([replaced], true)).toEqual([]);
  });
});
