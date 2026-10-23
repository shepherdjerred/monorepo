import { expect, test } from "vitest";
import { acceptedForumBaseline } from "#infrastructure/forum/baseline-context.ts";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { testOperator, testExecutor } from "#testing/seed.ts";
import {
  seedForum,
  baselineProof,
  bindCompoundForum,
  qualifyForumReleaseFixture,
} from "./fixtures.ts";
import {
  createForumBaselineInspector,
  createForumBaselineReader,
} from "./baseline-inspector.ts";
import type { ForumBaselineContext } from "#shared/contract.ts";
import { forumBundlePolicy } from "@shepherdjerred/ops-model/forum-bundle-policy.ts";

const fixture = useDeliveryFixture({
  forumPolicyReader: () => Promise.resolve(forumBundlePolicy),
});
async function context(compound = false) {
  await seedForum(fixture.delivery);
  if (compound) await bindCompoundForum(fixture.delivery);
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
  runtimeDigest = input.image.runtimeDigests[0] ?? "missing",
) {
  const requests: string[] = [],
    runtime = `${input.image.uri}@${input.image.digest}`,
    imageID = `${input.image.uri}@${runtimeDigest}`;
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
      spec: {},
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
  const object = (kind: string, name: string) => {
    const body = structuredClone(resources[kind]);
    if (body === undefined) throw new Error("Unexpected native request");
    if (kind === "Deployment")
      body["metadata"] = metadata(name, "deployment-uid");
    if (kind === "PersistentVolumeClaim") {
      body["metadata"] = metadata(name, `${name}-uid`);
      body["spec"] = { volumeName: `${name}-pv` };
    }
    mutate?.(kind, body);
    return body;
  };
  // Owned objects the resource tree would show, plus a sibling workload's.
  const lists: Record<string, unknown[]> = {
    replicasets: [
      {
        metadata: {
          ...metadata("storm-forum-database-rs", "database-rs-uid"),
          ownerReferences: [{ kind: "Deployment", uid: "database-uid" }],
        },
      },
      {
        metadata: {
          ...metadata("storm-forum-web-rs", "rs-uid"),
          ownerReferences: [{ kind: "Deployment", uid: "deployment-uid" }],
        },
      },
    ],
    pods: [
      {
        metadata: {
          ...metadata("storm-forum-database-xyz", "database-pod-uid"),
          ownerReferences: [{ kind: "ReplicaSet", uid: "database-rs-uid" }],
        },
      },
      { metadata: object("Pod", "storm-forum-web-abc")["metadata"] },
    ],
  };
  const kinds: Record<string, string> = {
    pods: "Pod",
    persistentvolumeclaims: "PersistentVolumeClaim",
    deployments: "Deployment",
    jobs: "Job",
  };
  return {
    requests,
    readApplication: async (name: string) => {
      requests.push(`application:${name}`);
      return object("Application", name);
    },
    readKubernetes: async (path: string) => {
      requests.push(path);
      const match =
        /^\/(?:api\/v1|apis\/apps\/v1|apis\/batch\/v1)\/namespaces\/storm-forum\/([a-z]+)(?:\/([a-z0-9-]+))?$/u.exec(
          path,
        );
      const collection = match?.[1] ?? "";
      const name = match?.[2];
      if (name === undefined) {
        const items = lists[collection];
        if (items === undefined) throw new Error(`Unexpected list ${path}`);
        return { items };
      }
      const kind = kinds[collection];
      if (kind === undefined) throw new Error(`Unexpected read ${path}`);
      return object(kind, name);
    },
    fetch: async (raw: string | URL | Request, init?: RequestInit) => {
      const url = new URL(raw instanceof Request ? raw.url : raw);
      requests.push(url.href);
      expect(url.hostname).toBe("10.244.0.50");
      expect(url.port).toBe("8082");
      expect(url.pathname).toBe("/_delivery/status");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer observer-test-capability",
      );
      return Response.json(baselineProof(input).runtime);
    },
  };
}

test.each(["index", "child"])(
  "accepts cluster-scoped tree nodes and settles the qualified %s runtime identity",
  async (identity) => {
    const input = await context(),
      transport = nativeTransport(
        input,
        undefined,
        identity === "index"
          ? input.image.digest
          : input.image.runtimeDigests[0],
      );
    const inspect = createForumBaselineInspector({
      readApplication: transport.readApplication,
      readKubernetes: transport.readKubernetes,
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
    // Two observations: Application, claims, database, Job, web workload,
    // ReplicaSets, Pods, the Pod, its status and the claims again.
    expect(transport.requests).toHaveLength(24);
    expect(transport.requests.some((url) => url.includes("argo"))).toBe(false);
    const settled = await fixture.delivery.completeForumBaseline(
      input.intent.id,
      {
        expectedEnvironmentGeneration: 0,
        snapshotFingerprint: input.intent.snapshotFingerprint,
      },
      testExecutor,
      inspect,
    );
    expect(settled.status).toBe("succeeded");
  },
);

test("a compound recipe inspects the Application that releases its forum bundle", async () => {
  const input = await context(true),
    transport = nativeTransport(input);
  const inspect = createForumBaselineInspector({
    readApplication: transport.readApplication,
    readKubernetes: transport.readKubernetes,
    observationToken: "observer-test-capability",
    policyReader: () => Promise.resolve(forumBundlePolicy),
    fetch: transport.fetch,
  });
  const proof = await inspect(input);
  expect(proof.application.name).toBe("storm-forum");
  const applications = transport.requests.filter((request) =>
    request.startsWith("application:"),
  );
  expect(applications.length).toBeGreaterThan(0);
  expect(new Set(applications)).toEqual(new Set(["application:storm-forum"]));
  expect(
    transport.requests.some((request) =>
      request.includes("storm-forum-search"),
    ),
  ).toBe(false);
});

test("unknown runtime digests cannot establish a Forum baseline", async () => {
  const input = await context(),
    transport = nativeTransport(input, undefined, `sha256:${"f".repeat(64)}`);
  await expect(
    createForumBaselineInspector({
      readApplication: transport.readApplication,
      readKubernetes: transport.readKubernetes,
      observationToken: "observer-test-capability",
      policyReader: () => Promise.resolve(forumBundlePolicy),
      fetch: transport.fetch,
    })(input),
  ).rejects.toThrow("original qualified platform digests");
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
      readApplication: transport.readApplication,
      readKubernetes: transport.readKubernetes,
      observationToken: "observer-test-capability",
      policyReader: () => Promise.resolve(forumBundlePolicy),
      fetch: transport.fetch,
    })(input),
  ).rejects.toThrow(/changed/u);
  await expect(
    createForumBaselineInspector({
      readApplication: transport.readApplication,
      readKubernetes: transport.readKubernetes,
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
    readApplication: transport.readApplication,
    readKubernetes: transport.readKubernetes,
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
      readApplication: transport.readApplication,
      readKubernetes: transport.readKubernetes,
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
    readApplication: transport.readApplication,
    readKubernetes: transport.readKubernetes,
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
  const baseline = await acceptedForumBaseline(
    fixture.delivery.database,
    env.id,
  );
  expect(baseline?.id).toBe(input.intent.id);
  const candidate = await qualifyForumReleaseFixture(
    fixture.delivery,
    "forum/native-legacy-first",
  );
  const deployment = await fixture.delivery.createDeployment(
    {
      requestId: "forum/native-legacy-upgrade",
      environmentId: input.environment.id,
      expectedGeneration: 0,
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
    transport.requests.filter((url) => url.endsWith("/storm-forum/pods")),
  ).toHaveLength(4);
});

test("settlement reads only through its projected readers and keeps ownership without them", async () => {
  const input = await context(),
    transport = nativeTransport(input);
  await expect(
    createForumBaselineInspector({
      readApplication: transport.readApplication,
      readKubernetes: createForumBaselineReader(() =>
        Promise.reject(new Error("token file missing")),
      ),
      observationToken: "observer-test-capability",
      policyReader: () => Promise.resolve(forumBundlePolicy),
      fetch: transport.fetch,
    })(input),
  ).rejects.toMatchObject({
    code: "PAUSED",
    message: expect.stringContaining(
      "the projected delivery-forum-baseline-reader identity is required",
    ),
  });
  await expect(
    createForumBaselineInspector({
      readApplication: async () => null,
      readKubernetes: transport.readKubernetes,
      observationToken: "observer-test-capability",
      policyReader: () => Promise.resolve(forumBundlePolicy),
      fetch: transport.fetch,
    })(input),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    createForumBaselineInspector({
      readApplication: transport.readApplication,
      readKubernetes: async (path) =>
        path.endsWith("/jobs/storm-forum-release-abcdef")
          ? null
          : await transport.readKubernetes(path),
      observationToken: "observer-test-capability",
      policyReader: () => Promise.resolve(forumBundlePolicy),
      fetch: transport.fetch,
    })(input),
  ).rejects.toThrow(/does not exist; keep target ownership/u);
});
