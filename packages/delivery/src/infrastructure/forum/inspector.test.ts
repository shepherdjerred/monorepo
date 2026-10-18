import { expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { testOperator, testExecutor } from "#testing/seed.ts";
import {
  seedForum,
  baselineProof,
  qualifyForumReleaseFixture,
} from "./fixtures.ts";
import { createForumBaselineInspector } from "./baseline-inspector.ts";
import type { ForumBaselineContext } from "#shared/contract.ts";
import { forumBundlePolicy } from "@shepherdjerred/ops-model/forum-bundle-policy.ts";

const fixture = useDeliveryFixture({
  forumPolicyReader: () => Promise.resolve(forumBundlePolicy),
});
async function context() {
  await seedForum(fixture.delivery);
  const intent = await fixture.delivery.requestForumBaseline(
    {
      requestId: crypto.randomUUID(),
      environmentId: "storm-forum/prod",
      expectedEnvironmentGeneration: 0,
      imageArtifactId: "forum-image",
      bundleArtifactId: "forum-bundle",
      reason:
        "Verify original forum with independently authenticated real native observations",
    },
    testOperator,
  );
  return fixture.delivery.forumBaseline(intent.id, testExecutor);
}
const metadata = (name: string, uid: string) => ({
  name,
  uid,
  resourceVersion: "10",
});
function nativeTransport(
  input: ForumBaselineContext,
  mutate?: (kind: string, resource: Record<string, unknown>) => void,
) {
  const requests: string[] = [],
    runtime = `${input.image.uri}@${input.image.digest}`,
    imageID = `${input.image.uri}@${input.image.runtimeDigests[0] ?? "missing"}`;
  const container = (name: string) => ({
    name,
    image: runtime,
    env: [
      { name: "BUNDLE_BUCKET", value: "storm-forum-releases" },
      {
        name: "BUNDLE_KEY",
        value: `releases/${input.bundle.digest.slice(7)}.zip`,
      },
      { name: "BUNDLE_SHA256", value: input.bundle.digest.slice(7) },
    ],
  });
  return {
    requests,
    fetch: async (raw: string | URL | Request, init?: RequestInit) => {
      const url = new URL(raw instanceof Request ? raw.url : raw),
        kind = url.searchParams.get("kind") ?? "Application";
      const name = url.searchParams.get("resourceName") ?? "";
      requests.push(url.href);
      if (url.port === "8082") {
        expect(url.hostname).toBe("10.244.0.50");
        expect(url.pathname).toBe("/_delivery/status");
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer observer-test-capability",
        );
        return Response.json(baselineProof(input).runtime);
      }
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer argo-test-capability",
      );
      if (url.pathname.endsWith("/resource"))
        expect(url.searchParams.get("group")).toBe(
          ["Pod", "PersistentVolumeClaim"].includes(kind)
            ? ""
            : kind === "Job"
              ? "batch"
              : "apps",
        );
      if (url.pathname.endsWith("/resource-tree"))
        return Response.json({
          nodes: [
            {
              kind: "Namespace",
              name: "storm-forum",
              uid: "namespace-uid",
            },
            {
              kind: "Pod",
              name: "out-of-scope-pod",
              uid: "out-of-scope-pod-uid",
              parentRefs: [{ uid: "rs-uid" }],
            },
            {
              kind: "ReplicaSet",
              name: "storm-forum-web-rs",
              namespace: "storm-forum",
              uid: "rs-uid",
              parentRefs: [{ uid: "deployment-uid" }],
            },
            {
              kind: "Pod",
              name: "storm-forum-web-abc",
              namespace: "storm-forum",
              uid: "pod-uid",
              parentRefs: [{ uid: "rs-uid" }],
            },
          ],
        });
      const resources: Record<string, Record<string, unknown>> = {
        Application: {
          metadata: metadata("storm-forum", "app-uid"),
          spec: {
            source: {
              repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
              chart: "storm-forum",
              targetRevision: "1.0.0",
            },
          },
          status: {
            sync: { status: "Synced" },
            health: { status: "Healthy" },
            operationState: { phase: "Succeeded" },
            resources: [
              {
                kind: "Job",
                name: "storm-forum-release-abcdef",
                namespace: "storm-forum",
              },
            ],
          },
        },
        Deployment: {
          metadata: metadata(name, "deployment-uid"),
          spec: {
            template: {
              spec: {
                volumes: [
                  {
                    name: "database",
                    persistentVolumeClaim: {
                      claimName: "storm-forum-database",
                    },
                  },
                ],
              },
            },
          },
        },
        PersistentVolumeClaim: {
          metadata: metadata(name, `${name}-uid`),
          spec: { volumeName: `${name}-pv` },
          status: { phase: "Bound" },
        },
        Job: {
          metadata: metadata("storm-forum-release-abcdef", "job-uid"),
          spec: {
            template: {
              spec: {
                containers: [container("release")],
                initContainers: [container("assemble")],
                volumes: [
                  {
                    name: "files",
                    persistentVolumeClaim: { claimName: "storm-forum-files" },
                  },
                ],
              },
            },
          },
          status: {
            succeeded: 1,
            completionTime: "2026-10-16T10:00:00Z",
            conditions: [{ type: "Complete", status: "True" }],
          },
        },
        Pod: {
          metadata: {
            ...metadata("storm-forum-web-abc", "pod-uid"),
            ownerReferences: [{ kind: "ReplicaSet", uid: "rs-uid" }],
          },
          spec: {
            containers: [container("php"), container("activities")],
            initContainers: [container("assemble")],
            volumes: [
              {
                name: "files",
                persistentVolumeClaim: { claimName: "storm-forum-files" },
              },
            ],
          },
          status: {
            phase: "Running",
            podIP: "10.244.0.50",
            conditions: [{ type: "Ready", status: "True" }],
            containerStatuses: [
              { name: "php", ready: true, imageID },
              { name: "activities", ready: true, imageID },
            ],
          },
        },
      };
      const body = resources[kind];
      if (body === undefined) throw new Error("Unexpected native request");
      mutate?.(kind, body);
      return Response.json(
        kind === "Application" ? body : { manifest: JSON.stringify(body) },
      );
    },
  };
}

test("accepts cluster-scoped tree nodes while proving the exact namespaced Job and ready runtime twice", async () => {
  const input = await context(),
    transport = nativeTransport(input);
  const inspect = createForumBaselineInspector({
    argoOrigin: "https://argo.test",
    argoToken: "argo-test-capability",
    observationToken: "observer-test-capability",
    policyReader: () => Promise.resolve(forumBundlePolicy),
    fetch: transport.fetch,
  });
  const proof = await inspect(input);
  expect(proof.releaseJob.uid).toBe("job-uid");
  expect(proof.pods[0]?.uid).toBe("pod-uid");
  expect(
    transport.requests.filter((url) => url.endsWith("/_delivery/status")),
  ).toHaveLength(2);
  expect(transport.requests).toHaveLength(22);
});
test("rejects changed native source between observations and never falls back to unauthenticated health", async () => {
  const input = await context();
  let applications = 0;
  const transport = nativeTransport(input, (kind, body) => {
    if (kind === "Application") {
      applications++;
      body["metadata"] = {
        name: "storm-forum",
        uid: "app-uid",
        resourceVersion: String(applications),
      };
    }
  });
  await expect(
    createForumBaselineInspector({
      argoOrigin: "https://argo.test",
      argoToken: "argo-test-capability",
      observationToken: "observer-test-capability",
      policyReader: () => Promise.resolve(forumBundlePolicy),
      fetch: transport.fetch,
    })(input),
  ).rejects.toThrow(/changed/u);
  await expect(
    createForumBaselineInspector({
      argoOrigin: "https://argo.test",
      argoToken: "argo-test-capability",
      observationToken: undefined,
      policyReader: () => Promise.resolve(forumBundlePolicy),
      fetch: transport.fetch,
    })(input),
  ).rejects.toThrow(/not provisioned/u);
});

test("legacy adoption reads the exact original Pod twice without requiring the future HTTP observer", async () => {
  const input = await context(),
    transport = nativeTransport(input),
    calls: unknown[] = [];
  const proof = await createForumBaselineInspector({
    argoOrigin: "https://argo.test",
    argoToken: "argo-test-capability",
    observationToken: undefined,
    fetch: transport.fetch,
    originalPolicyReader: () =>
      Promise.resolve({ policy: forumBundlePolicy, legacy: true }),
    nativeReader: async (request) => {
      calls.push(request);
      return baselineProof(input).runtime;
    },
  })(input);
  expect(calls).toEqual(
    Array.from({ length: 2 }, () => ({
      namespace: "storm-forum",
      pod: "storm-forum-web-abc",
      uid: "pod-uid",
    })),
  );
  expect(transport.requests.some((url) => url.includes(":8082"))).toBe(false);
  expect(proof.storage.map((claim) => claim.uid)).toEqual([
    "storm-forum-files-uid",
    "storm-forum-database-uid",
  ]);
  expect(proof.imageArtifactId).toBe(input.image.id);
  expect(proof.bundleArtifactId).toBe(input.bundle.id);
});

test("rejects a rebound original PVC during legacy native inspection", async () => {
  const input = await context();
  let observed = false;
  const transport = nativeTransport(input, (kind, body) => {
    if (kind === "PersistentVolumeClaim" && observed)
      body["spec"] = { volumeName: "replacement-world" };
  });
  await expect(
    createForumBaselineInspector({
      argoOrigin: "https://argo.test",
      argoToken: "argo-test-capability",
      observationToken: undefined,
      fetch: transport.fetch,
      originalPolicyReader: () =>
        Promise.resolve({ policy: forumBundlePolicy, legacy: true }),
      nativeReader: async () => {
        observed = true;
        return baselineProof(input).runtime;
      },
    })(input),
  ).rejects.toThrow(/PVC identity changed/u);
});

test("legacy adoption establishes only a baseline and repeats the same native proof before first candidate selection", async () => {
  const input = await context(),
    transport = nativeTransport(input);
  const inspect = createForumBaselineInspector({
    argoOrigin: "https://argo.test",
    argoToken: "argo-test-capability",
    observationToken: undefined,
    fetch: transport.fetch,
    originalPolicyReader: () =>
      Promise.resolve({ policy: forumBundlePolicy, legacy: true }),
    nativeReader: () => Promise.resolve(baselineProof(input).runtime),
  });
  const intent = await fixture.delivery.completeForumBaseline(
    input.intent.id,
    {
      expectedEnvironmentGeneration: 0,
      snapshotFingerprint: input.intent.snapshotFingerprint,
    },
    testExecutor,
    inspect,
  );
  expect(intent.status).toBe("succeeded");
  const env = await fixture.delivery.database.environment.findUniqueOrThrow({
    where: { id: input.environment.id },
  });
  expect(env.acceptedVersionSetRevisionId).toBeNull();
  expect(env.acceptedForumBaselineIntentId).toBe(input.intent.id);
  const candidate = await qualifyForumReleaseFixture(
    fixture.delivery,
    "forum/native-legacy-first",
  );
  const deployment = await fixture.delivery.createDeployment(
    {
      requestId: "forum/native-legacy-upgrade",
      environmentId: input.environment.id,
      expectedGeneration: 1,
      versionSetRevisionId: candidate.id,
      kind: "deploy",
    },
    testOperator,
  );
  await fixture.delivery.claim(deployment.id, testExecutor);
  await expect(
    fixture.delivery.verifyForumDeploymentBaseline(
      deployment.id,
      testExecutor,
      inspect,
    ),
  ).resolves.toEqual({ verified: true });
  expect(
    transport.requests.filter((url) => url.includes("/resource-tree")),
  ).toHaveLength(4);
});
