import { describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  isVerifiedRootReleaseTermination,
  VERIFIED_ROOT_RELEASE_ANNOTATION,
} from "@shepherdjerred/ops-model/argocd-release-receipt.ts";
import {
  runArgocdCommand,
  SyncInfoEntrySchema,
  SyncRequestSchema,
} from "./argocd-script-support.ts";

const PACKAGE_ROOT = path.resolve(import.meta.dir, "../../..");
const ARGOCD_SCRIPT = path.join(PACKAGE_ROOT, "scripts/argocd/argocd.ts");
const RELEASE_RESULT_FILE = "homelab-release-result.json";
describe("Delivery root canonical authority", () => {
  test.each([1, 2, 3])(
    "fresh admission refuses lost ownership at canonical boundary %s",
    async (boundary) => {
      const directory = await mkdtemp(
        path.join(tmpdir(), "delivery-root-authority-"),
      );
      const inventory = [{ name: "apps", revision: "2.0.0-42", prune: false }];
      const inventoryPath = path.join(directory, "expected.json");
      await Bun.write(inventoryPath, JSON.stringify(inventory));
      let admissions = 0,
        publications = 0,
        syncs = 0,
        live = false;
      let operation: Record<string, unknown> | undefined;
      let selected: ReturnType<typeof SyncRequestSchema.parse> | undefined;
      const manifest = JSON.stringify({
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "apps", namespace: "argocd" },
        spec: {
          source: {
            repoURL: "https://chartmuseum.sjer.red",
            chart: "apps",
            targetRevision: "2.0.0-42",
          },
          syncPolicy: { automated: { enabled: false } },
        },
      });
      function observedRoot() {
        if (operation === undefined) return { status: {} };
        return {
          ...(live ? { operation } : {}),
          status: {
            operationState: {
              phase: live ? "Running" : "Failed",
              message: live ? "" : "Operation terminated",
              startedAt: "2026-10-19T00:00:00Z",
              operation,
              syncResult: {
                revision: "2.0.0-42",
                resources: selected?.resources.map((r) => ({
                  ...r,
                  status: "Synced",
                })),
              },
            },
          },
        };
      }
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const url = new URL(request.url);
          if (url.pathname === "/admit") {
            admissions++;
            return admissions === boundary
              ? Response.json(
                  {
                    error: [
                      "lost claim",
                      "cancelled intent",
                      "snapshot mismatch",
                    ][boundary - 1],
                  },
                  { status: 409 },
                )
              : Response.json({ admitted: true });
          }
          if (url.pathname === "/api/charts/apps") {
            publications++;
            return Response.json([{ version: "2.0.0-99" }]);
          }
          if (url.pathname === "/api/v1/applications/apps/manifests")
            return Response.json({ manifests: [manifest] });
          if (
            request.method === "POST" &&
            url.pathname === "/api/v1/applications/apps/sync"
          ) {
            syncs++;
            const body: unknown = await request.json();
            selected = SyncRequestSchema.parse(body);
            operation = operationForSyncRequest(body);
            live = true;
            return Response.json({ operation });
          }
          if (
            request.method === "DELETE" &&
            url.pathname === "/api/v1/applications/apps/operation"
          ) {
            live = false;
            return Response.json({});
          }
          return url.pathname === "/api/v1/applications/apps"
            ? Response.json(observedRoot())
            : new Response("not found", { status: 404 });
        },
      });
      const script = path.resolve(
        import.meta.dirname,
        "../../../scripts/argocd/argocd.ts",
      );
      const program = `import {releaseRoot} from ${JSON.stringify(script)};const inventory=${JSON.stringify(inventory)};await releaseRoot('apps',${JSON.stringify(inventoryPath)},'2.0.0-42',${JSON.stringify(RELEASE_REQUEST_ID)},1,false,{requestId:${JSON.stringify(RELEASE_REQUEST_ID)},revision:'2.0.0-42',inventory,authorize:async()=>{const r=await fetch(${JSON.stringify(server.url.origin + "/admit")});if(!r.ok)throw Error('Fresh PG admission denied '+(await r.json()).error);}},${JSON.stringify(path.join(directory, "result.json"))});`;
      try {
        const result = await runArgocdCommand(["bun", "-e", program], {
          cwd: directory,
          env: {
            ...Bun.env,
            ARGOCD_TOKEN: "test-token",
            ARGOCD_SERVER_URL: server.url.origin,
            CHARTMUSEUM_ORIGIN: server.url.origin,
            ARGOCD_POLL_INTERVAL_MS: "5",
          },
        });
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain("Fresh PG admission denied");
        expect(admissions).toBe(boundary);
        expect(publications).toBe(0);
        expect(syncs).toBe(boundary === 1 ? 0 : 1);
        expect(
          await Bun.file(path.join(directory, "result.json")).exists(),
        ).toBe(false);
      } finally {
        await server.stop(true);
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
  test.each(["request", "revision", "inventory"])(
    "rejects mismatched %s authority before admission or Argo effects",
    async (mismatch) => {
      const directory = await mkdtemp(
        path.join(tmpdir(), "delivery-root-binding-"),
      );
      const expectedPath = path.join(directory, "expected.json"),
        inventory = [{ name: "apps", revision: "2.0.0-42", prune: false }];
      await Bun.write(expectedPath, JSON.stringify(inventory));
      const authority = {
        requestId:
          mismatch === "request" ? crypto.randomUUID() : RELEASE_REQUEST_ID,
        revision: mismatch === "revision" ? "2.0.0-99" : "2.0.0-42",
        inventory:
          mismatch === "inventory"
            ? [{ ...inventory[0], prune: true }]
            : inventory,
      };
      const script = path.resolve(
        import.meta.dirname,
        "../../../scripts/argocd/argocd.ts",
      );
      try {
        const result = await runArgocdCommand(
          [
            "bun",
            "-e",
            `import {releaseRoot} from ${JSON.stringify(script)};await releaseRoot('apps',${JSON.stringify(expectedPath)},'2.0.0-42',${JSON.stringify(RELEASE_REQUEST_ID)},1,false,{...${JSON.stringify(authority)},authorize:async()=>{throw Error('Admission must not run');}});`,
          ],
          { cwd: directory },
        );
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain(
          "authority differs from the exact request and inventory",
        );
        expect(result.stderr).not.toContain("Admission must not run");
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});

const ReleaseReceiptSchema = z.object({
  outcome: z.string(),
  requestId: z.string(),
  revision: z.string(),
});

const RELEASE_REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const RELEASE_OPERATION_ID = "33333333-3333-4333-8333-333333333333";
const BATCH_PHASE_INFO = {
  name: "ci.sjer.red/release-phase",
  value: "batch",
} as const;
const PRUNE_PHASE_INFO = {
  name: "ci.sjer.red/release-phase",
  value: "prune",
} as const;

function rootReleaseCommandOptions(origin: string, cwd = PACKAGE_ROOT) {
  return {
    cwd,
    env: {
      ...Bun.env,
      ARGOCD_POLL_INTERVAL_MS: "5",
      ARGOCD_SERVER_URL: origin,
      ARGOCD_TOKEN: "test-token",
      CHARTMUSEUM_ORIGIN: origin,
    },
  };
}

function runRootFinalization(origin: string) {
  return runArgocdCommand(
    [
      "bun",
      "--no-install",
      ARGOCD_SCRIPT,
      "finalize-root-release",
      "apps",
      "--revision",
      "2.0.0-43",
      "--request-id",
      RELEASE_REQUEST_ID,
      "--timeout",
      "1",
    ],
    rootReleaseCommandOptions(origin),
  );
}

const RootSyncRequestSchema = z.object({
  infos: z.array(SyncInfoEntrySchema),
  prune: z.boolean(),
  revision: z.string().optional(),
  source: z
    .object({
      chart: z.string(),
      repoURL: z.string(),
      targetRevision: z.string(),
    })
    .optional(),
  syncOptions: z.array(z.string()).optional(),
});

function operationForRootSyncRequest(
  request: unknown,
): Record<string, unknown> {
  const syncRequest = RootSyncRequestSchema.parse(request);
  return {
    info: syncRequest.infos,
    initiatedBy: { username: "woodpecker" },
    sync: {
      prune: syncRequest.prune,
      ...(syncRequest.revision === undefined
        ? {}
        : { revision: syncRequest.revision }),
      ...(syncRequest.source === undefined
        ? {}
        : { source: syncRequest.source }),
      ...(syncRequest.syncOptions === undefined
        ? {}
        : { syncOptions: syncRequest.syncOptions }),
    },
  };
}

const WorkerApplicationResource = {
  group: "argoproj.io",
  kind: "Application",
  name: "worker",
};

const RootApplicationResource = {
  group: "argoproj.io",
  kind: "Application",
  name: "apps",
};

const RootApplicationSource = {
  chart: "apps",
  repoURL: "https://chartmuseum.sjer.red",
  targetRevision: "2.0.0-43",
};

const StagedRootApplication = JSON.stringify({
  apiVersion: "argoproj.io/v1alpha1",
  kind: "Application",
  metadata: { name: "apps" },
  spec: {
    source: RootApplicationSource,
    syncPolicy: {
      automated: { enabled: true, prune: true, selfHeal: true },
    },
  },
});

const StagedRepositoryApplication = JSON.stringify({
  apiVersion: "argoproj.io/v1alpha1",
  kind: "Application",
  metadata: { name: "worker" },
  spec: {
    source: {
      repoURL: "https://chartmuseum.sjer.red",
      chart: "worker",
      targetRevision: "2.0.0-43",
    },
    syncPolicy: {
      automated: { enabled: false, prune: true, selfHeal: true },
    },
  },
});

const StagedAdmissionPolicy = JSON.stringify({
  apiVersion: "admissionregistration.k8s.io/v1",
  kind: "ValidatingAdmissionPolicy",
  metadata: {
    name: "pvc-backup-policy.sjer.red",
    annotations: { "argocd.argoproj.io/sync-wave": "1" },
  },
  spec: { failurePolicy: "Fail" },
});

const StagedExternalApplication = JSON.stringify({
  apiVersion: "argoproj.io/v1alpha1",
  kind: "Application",
  metadata: { name: "external" },
  spec: {
    source: {
      repoURL: "https://charts.example.com",
      chart: "external",
      targetRevision: "1.0.0",
    },
    syncPolicy: { automated: { enabled: true } },
  },
});

function finalPruneResources(
  removedApplication: string,
  includeRoot: boolean,
): Record<string, unknown>[] {
  return [
    ...(includeRoot ? [{ ...RootApplicationResource, status: "Synced" }] : []),
    { ...WorkerApplicationResource, status: "Synced" },
    {
      group: "argoproj.io",
      kind: "Application",
      name: removedApplication,
      status: "Pruned",
    },
  ];
}

function operationForSyncRequest(request: unknown): Record<string, unknown> {
  const syncRequest = SyncRequestSchema.parse(request);
  return {
    info: syncRequest.infos,
    initiatedBy: { username: "woodpecker" },
    sync: {
      ...(syncRequest.manifests === undefined
        ? {}
        : { manifests: syncRequest.manifests }),
      resources: syncRequest.resources,
    },
  };
}

function releaseOperationInfo(phase: "batch" | "prune") {
  return [
    { name: "ci.sjer.red/request-id", value: RELEASE_REQUEST_ID },
    { name: "ci.sjer.red/operation-id", value: RELEASE_OPERATION_ID },
    { name: "ci.sjer.red/revision", value: "2.0.0-43" },
    { name: "ci.sjer.red/release-phase", value: phase },
    ...(phase === "prune"
      ? [{ name: "ci.sjer.red/prune-candidates", value: "[]" }]
      : []),
  ];
}

test("root release finalization requires exact revision and request identity", async () => {
  const { exitCode, stderr } = await runArgocdCommand(
    [
      "bun",
      "--no-install",
      "scripts/argocd/argocd.ts",
      "finalize-root-release",
      "apps",
      "--revision",
      "2.0.0-43",
      "--dry-run",
    ],
    { cwd: path.resolve(import.meta.dir, "../../..") },
  );

  expect(exitCode).not.toBe(0);
  expect(stderr).toContain(
    "--revision and --request-id are required for finalize-root-release",
  );
});

const RemovedMonitoringRule = {
  group: "monitoring.coreos.com",
  kind: "PrometheusRule",
  namespace: "pokemon",
  name: "retired-goal-rules",
};

function rootPruneObservation(state: {
  activeRequest: unknown;
  requestedOperation: Record<string, unknown> | undefined;
  removedRulePruned: boolean;
  removedRule: { group: string; kind: string; namespace: string; name: string };
  removedApplication: string;
  reads: { final: number; selected: number };
}) {
  const {
    activeRequest,
    requestedOperation,
    removedRule,
    removedApplication,
    reads,
  } = state;
  if (activeRequest === undefined || requestedOperation === undefined) {
    return Response.json({
      status: {
        resources: [
          ...(state.removedRulePruned
            ? []
            : [{ ...removedRule, requiresPruning: true, status: "OutOfSync" }]),
          {
            group: "argoproj.io",
            kind: "Application",
            name: removedApplication,
          },
        ],
      },
    });
  }
  const manifestRequest = SyncRequestSchema.safeParse(activeRequest);
  const selectedPrune =
    manifestRequest.success && RootSyncRequestSchema.parse(activeRequest).prune;
  if (selectedPrune) reads.selected++;
  if (!manifestRequest.success) reads.final++;
  const resources = selectedPrune
    ? [{ ...removedRule, status: reads.selected > 1 ? "Pruned" : "Synced" }]
    : manifestRequest.success
      ? manifestRequest.data.resources.map((resource) => ({
          ...resource,
          status: "Synced",
        }))
      : finalPruneResources(removedApplication, reads.final > 1);
  return Response.json({
    operation: requestedOperation,
    status: {
      operationState: {
        phase: "Running",
        startedAt: new Date().toISOString(),
        operation: requestedOperation,
        syncResult: { revision: "2.0.0-43", resources },
      },
    },
  });
}

test.each([false, true])(
  "root finalization covers late non-Application prunes (resume=%s)",
  async (resumePrune) => {
    const syncBodies: unknown[] = [];
    let activeRequest: unknown;
    let requestedOperation: Record<string, unknown> | undefined;
    let deleteRequests = 0;
    const reads = { final: 0, selected: 0 };
    let removedRulePruned = false;
    const removedApplication = "removed-worker";
    const removedRule = RemovedMonitoringRule;
    const resumedPrune = {
      prune: true,
      revision: "2.0.0-43",
      resources: [removedRule],
      infos: releaseOperationInfo("prune").map((entry) =>
        entry.name === "ci.sjer.red/prune-candidates"
          ? {
              ...entry,
              value: JSON.stringify([
                JSON.stringify([
                  removedRule.group,
                  removedRule.kind,
                  removedRule.name,
                ]),
              ]),
            }
          : entry,
      ),
    };
    if (resumePrune) {
      activeRequest = resumedPrune;
      requestedOperation = {
        info: resumedPrune.infos,
        initiatedBy: { username: "delivery-platform" },
        sync: { prune: true, revision: "2.0.0-43", resources: [removedRule] },
      };
    }
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/api/charts/apps") {
          return Response.json([
            {
              version: "2.0.0-43",
              urls: ["charts/apps-2.0.0-43.tgz"],
              digest: "a".repeat(64),
            },
          ]);
        }
        if (
          request.method === "GET" &&
          url.pathname === "/api/v1/applications/apps/manifests"
        ) {
          expect(url.searchParams.get("revision")).toBe("2.0.0-43");
          return Response.json({
            manifests: [
              StagedRootApplication,
              StagedRepositoryApplication,
              StagedExternalApplication,
              StagedAdmissionPolicy,
            ],
          });
        }
        if (
          request.method === "GET" &&
          url.pathname === `/api/v1/applications/${removedApplication}`
        ) {
          return Response.json({
            metadata: {
              annotations: {
                "ci.sjer.red/application-lifecycle": "cascade",
              },
              finalizers: ["resources-finalizer.argocd.argoproj.io"],
            },
          });
        }
        if (
          request.method === "POST" &&
          url.pathname === "/api/v1/applications/apps/sync"
        ) {
          activeRequest = await request.json();
          syncBodies.push(activeRequest);
          const manifestRequest = SyncRequestSchema.safeParse(activeRequest);
          requestedOperation = manifestRequest.success
            ? operationForSyncRequest(activeRequest)
            : operationForRootSyncRequest(activeRequest);
          if (
            manifestRequest.success &&
            RootSyncRequestSchema.parse(activeRequest).prune
          ) {
            requestedOperation = {
              ...requestedOperation,
              sync: { prune: true, resources: manifestRequest.data.resources },
            };
          }
          return Response.json({ operation: requestedOperation });
        }
        if (
          request.method === "DELETE" &&
          url.pathname === "/api/v1/applications/apps/operation"
        ) {
          deleteRequests += 1;
          if (
            activeRequest !== undefined &&
            SyncRequestSchema.safeParse(activeRequest).success &&
            RootSyncRequestSchema.parse(activeRequest).prune
          )
            removedRulePruned = true;
          activeRequest = undefined;
          requestedOperation = undefined;
          return Response.json({});
        }
        if (
          request.method === "GET" &&
          url.pathname === "/api/v1/applications/apps"
        ) {
          return rootPruneObservation({
            activeRequest,
            requestedOperation,
            removedRulePruned,
            removedRule,
            removedApplication,
            reads,
          });
        }
        return new Response("not found", { status: 404 });
      },
    });

    try {
      const { exitCode, stdout, stderr } = await runRootFinalization(
        server.url.origin,
      );

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("finalize-root-release: apps at 2.0.0-43");
      expect(stdout).toContain("syncing exact root batch 1/3 (2 resources)");
      expect(stdout).toContain("syncing exact root batch 2/3 (1 resources)");
      expect(stdout).toContain("syncing exact root batch 3/3 (1 resources)");
      expect(syncBodies).toHaveLength(resumePrune ? 4 : 5);
      expect(deleteRequests).toBe(5);
      expect(reads.final).toBeGreaterThanOrEqual(2);
      expect(reads.selected).toBeGreaterThanOrEqual(2);

      const applicationRequest = SyncRequestSchema.parse(syncBodies[0]);
      expect(applicationRequest.revision).toBe("2.0.0-43");
      expect(applicationRequest.infos).toContainEqual(BATCH_PHASE_INFO);
      expect(applicationRequest.resources).toEqual([
        WorkerApplicationResource,
        {
          group: "argoproj.io",
          kind: "Application",
          name: "external",
        },
      ]);
      expect(applicationRequest.manifests).toBeUndefined();

      const rootApplicationRequest = SyncRequestSchema.parse(syncBodies[1]);
      expect(rootApplicationRequest.resources).toEqual([
        RootApplicationResource,
      ]);
      const rootApplicationManifests = rootApplicationRequest.manifests;
      if (rootApplicationManifests === undefined) {
        throw new Error("Root Application is missing its suspended manifest");
      }
      expect(JSON.parse(rootApplicationManifests[0] ?? "")).toMatchObject({
        spec: { syncPolicy: { automated: { enabled: false } } },
      });

      const policyRequest = SyncRequestSchema.parse(syncBodies[2]);
      expect(policyRequest.resources).toEqual([
        {
          group: "admissionregistration.k8s.io",
          kind: "ValidatingAdmissionPolicy",
          name: "pvc-backup-policy.sjer.red",
        },
      ]);
      expect(policyRequest.manifests).toBeUndefined();
      const selectedPruneRequest = SyncRequestSchema.parse(
        resumePrune ? resumedPrune : syncBodies[3],
      );
      expect(selectedPruneRequest.resources).toEqual([removedRule]);
      const pruneRequest = RootSyncRequestSchema.parse(syncBodies.at(-1));
      expect(pruneRequest.prune).toBe(true);
      expect(pruneRequest.infos).toContainEqual(PRUNE_PHASE_INFO);
      const pruneCandidates = selectedPruneRequest.infos.find(
        (info) => info.name === "ci.sjer.red/prune-candidates",
      );
      expect(JSON.parse(pruneCandidates?.value ?? "null")).toContain(
        JSON.stringify([removedRule.group, removedRule.kind, removedRule.name]),
      );
      const rawPruneRequest = z
        .record(z.string(), z.unknown())
        .parse(syncBodies.at(-1));
      expect(rawPruneRequest["resources"]).toBeUndefined();
      expect(rawPruneRequest["manifests"]).toBeUndefined();
    } finally {
      await server.stop(true);
    }
  },
);

// A cluster-scoped selector has two equally valid spellings on the wire: Argo
// may omit `namespace` or send it empty. Both name the same target, so adoption
// has to accept either. Rejecting the empty one at the parse boundary aborted
// the whole batch before it could even look at the active operation.
for (const clusterScoped of [
  { label: "an omitted namespace", fields: {} },
  { label: "an empty namespace", fields: { namespace: "" } },
]) {
  test(`root release finalization adopts the exact active batch with ${clusterScoped.label} and without replaying prior waves`, async () => {
    const policyResource = {
      group: "admissionregistration.k8s.io",
      kind: "ValidatingAdmissionPolicy",
      name: "pvc-backup-policy.sjer.red",
      ...clusterScoped.fields,
    };
    const activeBatchRequest = {
      infos: releaseOperationInfo("batch"),
      prune: false,
      resources: [policyResource],
      revision: "2.0.0-43",
    };
    let activeRequest: unknown = activeBatchRequest;
    let requestedOperation: Record<string, unknown> | undefined =
      operationForSyncRequest(activeBatchRequest);
    let deleteRequests = 0;
    let syncPosts = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/api/charts/apps") {
          return Response.json([
            {
              version: "2.0.0-43",
              urls: ["charts/apps-2.0.0-43.tgz"],
              digest: "a".repeat(64),
            },
          ]);
        }
        if (
          request.method === "GET" &&
          url.pathname === "/api/v1/applications/apps/manifests"
        ) {
          return Response.json({
            manifests: [
              StagedRootApplication,
              StagedRepositoryApplication,
              StagedExternalApplication,
              StagedAdmissionPolicy,
            ],
          });
        }
        if (
          request.method === "POST" &&
          url.pathname === "/api/v1/applications/apps/sync"
        ) {
          syncPosts += 1;
          activeRequest = await request.json();
          requestedOperation = operationForRootSyncRequest(activeRequest);
          return Response.json({ operation: requestedOperation });
        }
        if (
          request.method === "DELETE" &&
          url.pathname === "/api/v1/applications/apps/operation"
        ) {
          deleteRequests += 1;
          activeRequest = undefined;
          requestedOperation = undefined;
          return Response.json({});
        }
        if (
          request.method === "GET" &&
          url.pathname === "/api/v1/applications/apps"
        ) {
          if (activeRequest === undefined || requestedOperation === undefined) {
            return Response.json({ status: { resources: [] } });
          }
          const manifestRequest = SyncRequestSchema.safeParse(activeRequest);
          return Response.json({
            operation: requestedOperation,
            status: {
              resources: [],
              operationState: {
                phase: "Running",
                startedAt: new Date().toISOString(),
                operation: requestedOperation,
                syncResult: {
                  revision: "2.0.0-43",
                  resources: manifestRequest.success
                    ? manifestRequest.data.resources.map((resource) => ({
                        ...resource,
                        status: "Synced",
                      }))
                    : [
                        { ...RootApplicationResource, status: "Synced" },
                        { ...WorkerApplicationResource, status: "Synced" },
                      ],
                },
              },
            },
          });
        }
        return new Response("not found", { status: 404 });
      },
    });

    try {
      const { exitCode, stdout, stderr } = await runRootFinalization(
        server.url.origin,
      );

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("adopting exact root batch 3/3 (1 resources)");
      expect(stdout).not.toContain("syncing exact root batch 1/2");
      expect(syncPosts).toBe(1);
      expect(deleteRequests).toBe(2);
    } finally {
      await server.stop(true);
    }
  });
}

test("root release finalization adopts the exact active prune without another POST", async () => {
  const postPruneCandidate = "post-prune-candidate";
  const activeOperation = operationForRootSyncRequest({
    infos: releaseOperationInfo("prune"),
    prune: true,
    revision: "2.0.0-43",
    source: RootApplicationSource,
    syncOptions: ["CreateNamespace=true"],
  });
  const unmarkedOperation = operationForRootSyncRequest({
    infos: releaseOperationInfo("prune").filter(
      ({ name }) => name !== "ci.sjer.red/release-phase",
    ),
    prune: true,
    revision: "2.0.0-43",
    source: RootApplicationSource,
    syncOptions: ["CreateNamespace=true"],
  });
  let marked = false;
  let live = true;
  let deleteRequests = 0;
  let syncPosts = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/api/charts/apps") {
        return Response.json([
          {
            version: "2.0.0-43",
            urls: ["charts/apps-2.0.0-43.tgz"],
            digest: "a".repeat(64),
          },
        ]);
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/applications/apps/manifests"
      ) {
        return Response.json({ manifests: [StagedRootApplication] });
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/v1/applications/apps/sync"
      ) {
        syncPosts += 1;
        return Response.json({});
      }
      if (
        request.method === "GET" &&
        url.pathname === `/api/v1/applications/${postPruneCandidate}`
      ) {
        return Response.json({
          metadata: {
            annotations: {
              "ci.sjer.red/application-lifecycle": "cascade",
            },
            finalizers: ["resources-finalizer.argocd.argoproj.io"],
          },
        });
      }
      if (
        request.method === "DELETE" &&
        url.pathname === "/api/v1/applications/apps/operation"
      ) {
        deleteRequests += 1;
        live = false;
        return Response.json({});
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/applications/apps"
      ) {
        if (!live) {
          return Response.json({ status: { resources: [] } });
        }
        const currentOperation = marked ? activeOperation : unmarkedOperation;
        return Response.json({
          operation: currentOperation,
          spec: {
            source: RootApplicationSource,
            syncPolicy: { syncOptions: ["CreateNamespace=true"] },
          },
          status: {
            resources: [
              {
                group: "argoproj.io",
                kind: "Application",
                name: postPruneCandidate,
              },
            ],
            operationState: {
              phase: "Running",
              startedAt: new Date().toISOString(),
              operation: currentOperation,
              syncResult: {
                revision: "2.0.0-43",
                resources: [{ ...RootApplicationResource, status: "Synced" }],
              },
            },
          },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });

  try {
    const { exitCode: unmarkedExitCode, stderr: unmarkedStderr } =
      await runRootFinalization(server.url.origin);
    expect(unmarkedExitCode).not.toBe(0);
    expect(unmarkedStderr).toContain(
      "full-source operation is not the marked final root prune",
    );
    expect(syncPosts).toBe(0);
    expect(deleteRequests).toBe(0);

    marked = true;
    const { exitCode, stdout, stderr } = await runRootFinalization(
      server.url.origin,
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("adopting active final root prune: apps");
    expect(syncPosts).toBe(0);
    expect(deleteRequests).toBe(1);
  } finally {
    await server.stop(true);
  }
});

test("release-root resumes at a live later phase instead of restaging", async () => {
  const activeOperation = operationForRootSyncRequest({
    infos: releaseOperationInfo("prune"),
    prune: true,
    revision: "2.0.0-43",
  });
  let live = true;
  let deleteRequests = 0;
  let syncPosts = 0;
  let receiptPatches = 0;
  let annotations: Record<string, string> = {};
  const startedAt = new Date().toISOString();
  let finishedAt: string | undefined;
  const observedApplication = () => ({
    metadata: { name: "apps", resourceVersion: "42", annotations },
    ...(live ? { operation: activeOperation } : {}),
    status: {
      resources: [],
      sync: { status: "Synced", revision: "2.0.0-43" },
      health: { status: "Healthy" },
      operationState: {
        phase: live ? "Running" : "Failed",
        message: live ? "" : "Operation terminated",
        startedAt,
        finishedAt,
        operation: activeOperation,
        syncResult: {
          revision: "2.0.0-43",
          resources: [{ ...RootApplicationResource, status: "Synced" }],
        },
      },
    },
  });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/api/charts/apps") {
        return Response.json([
          {
            version: "2.0.0-43",
            urls: ["charts/apps-2.0.0-43.tgz"],
            digest: "a".repeat(64),
          },
        ]);
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/applications/apps/manifests"
      ) {
        return Response.json({ manifests: [StagedRootApplication] });
      }
      if (request.method === "GET" && url.pathname === "/api/v1/applications") {
        return Response.json({ items: [] });
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/v1/applications/apps/sync"
      ) {
        syncPosts += 1;
        return Response.json({});
      }
      if (
        request.method === "DELETE" &&
        url.pathname === "/api/v1/applications/apps/operation"
      ) {
        deleteRequests += 1;
        live = false;
        finishedAt = new Date().toISOString();
        return Response.json({});
      }
      if (
        request.method === "PATCH" &&
        url.pathname === "/api/v1/applications/apps"
      ) {
        const body = z
          .object({ patchType: z.literal("json"), patch: z.string() })
          .parse(await request.json());
        const patch = z
          .array(
            z.object({ op: z.string(), path: z.string(), value: z.unknown() }),
          )
          .parse(JSON.parse(body.patch));
        expect(patch[0]).toEqual({
          op: "test",
          path: "/metadata/resourceVersion",
          value: "42",
        });
        const receipt = patch.find(
          (entry) =>
            entry.path ===
            "/metadata/annotations/ops.sjer.red~1verified-root-release",
        );
        annotations = {
          [VERIFIED_ROOT_RELEASE_ANNOTATION]: z.string().parse(receipt?.value),
        };
        receiptPatches += 1;
        return Response.json(observedApplication());
      }
      return request.method === "GET" &&
        url.pathname === "/api/v1/applications/apps"
        ? Response.json(observedApplication())
        : new Response("not found", { status: 404 });
    },
  });
  const directory = await mkdtemp(path.join(tmpdir(), "argocd-resume-"));
  const expectedPath = path.join(directory, "expected.json");
  await Bun.write(
    expectedPath,
    JSON.stringify([{ name: "apps", revision: "2.0.0-43" }]),
  );

  try {
    const { exitCode, stdout, stderr } = await runArgocdCommand(
      [
        "bun",
        "--no-install",
        ARGOCD_SCRIPT,
        "release-root",
        "apps",
        expectedPath,
        "--revision",
        "2.0.0-43",
        "--request-id",
        RELEASE_REQUEST_ID,
        "--timeout",
        "1",
      ],
      // A completed release writes its receipt relative to cwd. Keep that
      // artifact in the scratch directory, with an absolute script path.
      rootReleaseCommandOptions(server.url.origin, directory),
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain(
      `resuming apps release at the prune phase for request ${RELEASE_REQUEST_ID}`,
    );
    expect(stdout).toContain("adopting active final root prune: apps");
    expect(stdout).not.toContain("stage-root-release");
    expect(syncPosts).toBe(0);
    expect(deleteRequests).toBe(1);
    expect(receiptPatches).toBe(1);
    expect(isVerifiedRootReleaseTermination(observedApplication())).toBe(true);
    const receipt = ReleaseReceiptSchema.parse(
      await Bun.file(path.join(directory, RELEASE_RESULT_FILE)).json(),
    );
    expect(receipt.outcome).toBe("applied-verified");
    expect(receipt.requestId).toBe(RELEASE_REQUEST_ID);
    expect(receipt.revision).toBe("2.0.0-43");
    // The receipt belongs to the directory the release was driven from. A test
    // must never leave one behind in the package root of a working tree.
    expect(
      await Bun.file(path.join(PACKAGE_ROOT, RELEASE_RESULT_FILE)).exists(),
    ).toBe(false);
  } finally {
    await server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});

test("a corrected forward root request may stage after a different terminal interrupted request without rewriting its floating source", async () => {
  const oldRequestId = "22222222-2222-4222-8222-222222222222";
  const oldOperation = operationForRootSyncRequest({
    infos: [
      { name: "ci.sjer.red/request-id", value: oldRequestId },
      { name: "ci.sjer.red/operation-id", value: RELEASE_OPERATION_ID },
      { name: "ci.sjer.red/revision", value: "2.0.0-42" },
      PRUNE_PHASE_INFO,
    ],
    prune: true,
    revision: "2.0.0-42",
  });
  const root = {
    metadata: { name: "apps" },
    spec: { source: { ...RootApplicationSource, targetRevision: "~2.0.0-0" } },
    status: {
      sync: { status: "OutOfSync", revision: "2.0.0-43" },
      operationState: {
        phase: "Failed",
        message: "Operation terminated",
        finishedAt: new Date().toISOString(),
        operation: oldOperation,
        syncResult: { revision: "2.0.0-42", resources: [] },
      },
    },
  };
  const posts: unknown[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/api/charts/apps")
        return Response.json([
          {
            version: "2.0.0-43",
            urls: ["charts/apps-2.0.0-43.tgz"],
            digest: "a".repeat(64),
          },
        ]);
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/applications/apps/manifests"
      )
        return Response.json({ manifests: [StagedRootApplication] });
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/applications/apps"
      )
        return Response.json(root);
      if (
        request.method === "POST" &&
        url.pathname === "/api/v1/applications/apps/sync"
      ) {
        posts.push(await request.json());
        return new Response("forward-stage-admitted", { status: 503 });
      }
      return new Response("not found", { status: 404 });
    },
  });
  const directory = await mkdtemp(path.join(tmpdir(), "argocd-forward-root-"));
  const expected = path.join(directory, "expected.json");
  await Bun.write(
    expected,
    JSON.stringify([{ name: "apps", revision: "2.0.0-43" }]),
  );
  try {
    const result = await runArgocdCommand(
      [
        "bun",
        "--no-install",
        ARGOCD_SCRIPT,
        "release-root",
        "apps",
        expected,
        "--revision",
        "2.0.0-43",
        "--request-id",
        RELEASE_REQUEST_ID,
        "--timeout",
        "1",
      ],
      rootReleaseCommandOptions(server.url.origin, directory),
    );
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      prune: false,
      revision: "2.0.0-43",
      infos: expect.arrayContaining([
        { name: "ci.sjer.red/request-id", value: RELEASE_REQUEST_ID },
        { name: "ci.sjer.red/release-phase", value: "stage" },
      ]),
    });
    expect(result.exitCode).toBe(34);
    expect(result.stderr).toContain("forward-stage-admitted");
    expect(root.spec.source.targetRevision).toBe("~2.0.0-0");
    expect(root.status.operationState.operation).toEqual(oldOperation);
  } finally {
    await server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});

test("root release finalization refuses a batch selecting another namespace", async () => {
  // Same group, kind, and name as the rendered policy, but a namespace the
  // rendered revision never declares, so it is a different target.
  const activeOperation = {
    info: releaseOperationInfo("batch"),
    initiatedBy: { username: "woodpecker" },
    sync: {
      prune: false,
      resources: [
        {
          group: "admissionregistration.k8s.io",
          kind: "ValidatingAdmissionPolicy",
          name: "pvc-backup-policy.sjer.red",
          namespace: "other",
        },
      ],
      revision: "2.0.0-43",
    },
  };
  let syncPosts = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/api/charts/apps") {
        return Response.json([
          {
            version: "2.0.0-43",
            urls: ["charts/apps-2.0.0-43.tgz"],
            digest: "a".repeat(64),
          },
        ]);
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/applications/apps/manifests"
      ) {
        return Response.json({
          manifests: [
            StagedRootApplication,
            StagedRepositoryApplication,
            StagedExternalApplication,
            StagedAdmissionPolicy,
          ],
        });
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/v1/applications/apps/sync"
      ) {
        syncPosts += 1;
        return Response.json({});
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/applications/apps"
      ) {
        return Response.json({
          operation: activeOperation,
          status: {
            resources: [],
            operationState: {
              phase: "Running",
              startedAt: new Date().toISOString(),
              operation: activeOperation,
            },
          },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });

  try {
    const { exitCode, stderr } = await runRootFinalization(server.url.origin);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("does not match an exact root batch");
    expect(syncPosts).toBe(0);
  } finally {
    await server.stop(true);
  }
});
