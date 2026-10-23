import { expect, test } from "vitest";
import { createHash } from "node:crypto";
import { KubeConfig } from "@kubernetes/client-node";
import type { V1Job } from "@kubernetes/client-node";
import {
  ContentRecoveryNativeReceiptSchema,
  ContentRecoveryContextSchema,
} from "@shepherdjerred/delivery/contract";
import {
  FORUM_RECOVERY_ANNOTATIONS as annotations,
  ForumReleaseIdSchema,
  parseForumRecoveryAction,
  FORUM_RECOVERY_IMAGE_LABEL,
  FORUM_RECOVERY_IMAGE_ABI,
} from "@shepherdjerred/ops-model/forum-recovery.ts";
import {
  forumJobFingerprint,
  forumRecoveryChild,
  assertNoOtherForumWriter,
  forumImageProvesRelease,
  originalForumRecoveryJob,
  runForumRecoveryChild,
} from "./forum-jobs.ts";
import {
  forumDeployment,
  forumRecipe,
} from "#lib/delivery/model/forum-testing.ts";
import { artifact } from "#lib/delivery/model/testing.ts";

function localKubernetes(server: string) {
  const config = new KubeConfig();
  config.loadFromOptions({
    clusters: [{ name: "fixture", server, skipTLSVerify: true }],
    users: [{ name: "fixture" }],
    contexts: [{ name: "fixture", cluster: "fixture", user: "fixture" }],
    currentContext: "fixture",
  });
  return config;
}

function original() {
  const job = {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      namespace: "storm-forum",
      name: "storm-forum-release-0123456789ab",
      uid: crypto.randomUUID(),
    },
    spec: {
      backoffLimit: 0,
      activeDeadlineSeconds: 3600,
      template: {
        metadata: { labels: { app: "storm-forum", component: "release" } },
        spec: {
          restartPolicy: "Never",
          serviceAccountName: "storm-forum-worker",
          automountServiceAccountToken: false,
          initContainers: [
            {
              name: "assemble",
              image: `docker.io/shepherdjerred/storm-forum@sha256:${"a".repeat(64)}`,
              command: ["bun", "/opt/storm-forum/src/cli.ts", "assemble"],
            },
          ],
          containers: [
            {
              name: "release",
              image: `docker.io/shepherdjerred/storm-forum@sha256:${"a".repeat(64)}`,
              command: ["bun", "/opt/storm-forum/src/cli.ts", "release"],
              env: [
                { name: "FORUM_RELEASE_ID", value: "0123456789ab" },
                {
                  name: "DB_PASSWORD",
                  valueFrom: {
                    secretKeyRef: {
                      name: "original-secrets",
                      key: "DB_PASSWORD",
                    },
                  },
                },
                {
                  name: "FORUM_RECOVERY_INTENT_ID",
                  valueFrom: {
                    fieldRef: {
                      fieldPath: `metadata.annotations['${annotations.intent}']`,
                    },
                  },
                },
              ],
            },
          ],
          volumes: [
            {
              name: "files",
              persistentVolumeClaim: { claimName: "storm-forum-files" },
            },
          ],
        },
      },
    },
  } satisfies V1Job;
  const receipt = ContentRecoveryNativeReceiptSchema.shape.receipt.parse({
    namespace: "storm-forum",
    name: job.metadata?.name,
    uid: job.metadata?.uid,
    specFingerprint: forumJobFingerprint(job),
    requestId: "original/release",
  });
  return { job, receipt };
}

test.each(["status-only", "uid", "spec", "annotations", "suspension"])(
  "unsuspend revalidates the fresh Job after controller %s changes during its fence",
  async (change) => {
    const { job, receipt } = original();
    const intentId = "forum/recovery/fresh-cas";
    const nativeUID = crypto.randomUUID();
    const child = forumRecoveryChild({
      original: job,
      receipt,
      intentId,
      action: "inspect",
      attempt: 1,
    });
    if (!child.metadata || !child.spec?.template.spec)
      throw new Error("Complete child fixture required");
    child.metadata.uid = nativeUID;
    child.metadata.resourceVersion = "1";
    const result = { intentId, settled: true };
    let patches = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (request.method === "PATCH") {
          patches++;
          const patch: unknown = await request.json();
          expect(patch).toEqual([
            { op: "test", path: "/metadata/uid", value: nativeUID },
            { op: "test", path: "/metadata/resourceVersion", value: "2" },
            { op: "test", path: "/spec/suspend", value: true },
            { op: "replace", path: "/spec/suspend", value: false },
          ]);
          if (!child.spec) throw new Error("Expected child spec");
          child.spec.suspend = false;
          child.status = { conditions: [{ type: "Complete", status: "True" }] };
          return Response.json(child);
        }
        if (url.pathname.endsWith("/log"))
          return new Response(
            `FORUM_RECOVERY_RESULT_V1=${JSON.stringify(result)}`,
          );
        if (url.pathname.endsWith("/pods"))
          return Response.json({
            items: url.searchParams
              .get("labelSelector")
              ?.startsWith("job-name=")
              ? [
                  {
                    metadata: {
                      name: "child-pod",
                      ownerReferences: [{ kind: "Job", uid: nativeUID }],
                    },
                    status: { phase: "Succeeded" },
                  },
                ]
              : [],
          });
        return Response.json(child);
      },
    });
    const config = localKubernetes(server.url.origin);
    try {
      const inspection = runForumRecoveryChild({
        original: job,
        receipt,
        intentId,
        action: "inspect",
        attempt: 1,
        config,
        checkpoint: async (actual) => {
          expect(actual.uid).toBe(nativeUID);
        },
        fence: async () => {
          if (!child.metadata || !child.spec?.template.spec)
            throw new Error("Complete child fixture required");
          child.metadata.resourceVersion = "2";
          if (change === "uid") child.metadata.uid = crypto.randomUUID();
          if (change === "spec")
            child.spec.template.spec.containers[0]!.image = "unowned/image";
          if (change === "annotations") child.metadata.annotations = {};
          if (change === "suspension") child.spec.suspend = false;
        },
      });
      if (change === "status-only") {
        expect(await inspection).toEqual(result);
        expect(patches).toBe(1);
      } else {
        await expect(inspection).rejects.toThrow();
        expect(patches).toBe(0);
      }
    } finally {
      await server.stop(true);
    }
  },
);

test.each([
  {
    image: "a release baked with GIT_SHA",
    config: (revision: string) => ({
      Env: [`GIT_SHA=${revision}`],
      Labels: { [FORUM_RECOVERY_IMAGE_LABEL]: FORUM_RECOVERY_IMAGE_ABI },
    }),
  },
  {
    image: "a legacy release labelled with its revision",
    config: (revision: string) => ({
      Env: [],
      Labels: {
        "org.opencontainers.image.revision": revision,
        [FORUM_RECOVERY_IMAGE_LABEL]: FORUM_RECOVERY_IMAGE_ABI,
      },
    }),
  },
])(
  "original Forum recovery of $image projects the exact chart proof while retaining its separate operation identity",
  async ({ config: imageConfig }) => {
    const { job } = original();
    const deploymentId = "forum/original/selection";
    job.metadata.name = `storm-forum-release-${createHash("sha256").update(deploymentId).digest("hex").slice(0, 32)}`;
    const bytes = new TextEncoder().encode("immutable chart fixture");
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        return new URL(request.url).pathname.startsWith("/charts/")
          ? new Response(bytes)
          : Response.json(job);
      },
    });
    const createdAt = new Date().toISOString();
    const common = {
      serviceId: "storm-forum",
      buildId: "forum/build",
      sourceRevision: "a".repeat(40),
      createdAt,
      version: "2.3.13",
      digest: `sha256:${"a".repeat(64)}`,
    };
    const version = {
      id: "forum/set",
      serviceId: "storm-forum",
      revision: 1,
      baseRevisionId: null,
      lineage: "0".repeat(64),
      orderKey: "0000000001.0000000000",
      createdAt,
      components: {
        image: {
          ...common,
          id: "forum/image",
          component: "image",
          kind: "image",
          uri: "docker.io/shepherdjerred/storm-forum",
        },
        bundle: {
          ...common,
          id: "forum/bundle",
          component: "bundle",
          kind: "archive",
          uri: `s3://storm-forum-releases/releases/${"a".repeat(64)}.zip`,
          origin: {
            kind: "licensed-bundle",
            manifestDigest: `sha256:${"b".repeat(64)}`,
            xenforoVersion: "2.3.13",
            producerSourceRevision: common.sourceRevision,
          },
        },
        chart: {
          ...common,
          id: "forum/chart",
          component: "chart",
          kind: "chart",
          version: "2.0.0-1",
          uri: `${server.url.origin}/charts/storm-forum-2.0.0-1.tgz`,
          digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        },
      },
    };
    const context = ContentRecoveryContextSchema.parse({
      intent: {
        id: "forum/recovery",
        deploymentId,
        requestedBy: "operator",
        reason: "Inspect the original frozen Forum native release Job",
        expectedEnvironmentGeneration: 1,
        snapshotFingerprint: "a".repeat(64),
        status: "pending",
        message: null,
        createdAt,
        finishedAt: null,
        targetKind: "forum",
      },
      deployment: {
        deployment: {
          id: deploymentId,
          requestId: deploymentId,
          environmentId: "storm-forum/prod",
          serviceId: "storm-forum",
          versionSetRevisionId: version.id,
          pipelineRevisionId: "forum/1",
          configurationId: "forum/1",
          catalogRevision: "test-catalog",
          expectedGeneration: 1,
          kind: "deploy",
          status: "failed",
          requestedBy: "operator",
          message: null,
          cancelRequested: false,
          recoveryRequired: true,
          createdAt,
          startedAt: createdAt,
          finishedAt: createdAt,
        },
        environment: {
          id: "storm-forum/prod",
          serviceId: "storm-forum",
          name: "prod",
          application: "storm-forum",
          pipelineRevisionId: "forum/1",
          declaredConfigurationId: "forum/1",
          automatic: false,
          role: "durable",
          lifecycle: "active",
          approvalPolicy: "none",
          acceptedDeploymentId: null,
          generation: 1,
          desiredVersionSetRevisionId: null,
          observedVersionSetRevisionId: null,
          acceptedVersionSetRevisionId: null,
          promotionSourceEnvironmentId: null,
          observedAt: null,
          activeDeploymentId: deploymentId,
          createdAt,
        },
        versionSet: version,
        previousAcceptedVersionSet: version,
        pipeline: {
          id: "forum/1",
          createdAt,
          definition: {
            kind: "argocd",
            application: "storm-forum",
            namespace: "storm-forum",
            chartRepository: server.url.origin,
            chartName: "storm-forum",
            chartComponent: "chart",
            artifactParameters: { "delivery.image": "image" },
            parameters: {},
            forumRelease: {
              imageComponent: "image",
              bundleComponent: "bundle",
            },
          },
        },
        configuration: {
          id: "forum/1",
          content: { "forum.xenforoVersion": "2.3.13" },
        },
        previousAcceptedConfiguration: {
          id: "forum/1",
          content: { "forum.xenforoVersion": "2.3.13" },
        },
        evidence: [],
        stages: [],
      },
      priorDeployment: null,
      expectedSettlements: { desired: "a".repeat(64) },
      recoveryHistory: [],
    });
    const config = localKubernetes(server.url.origin);
    const commands: string[][] = [];
    try {
      const result = await originalForumRecoveryJob(
        context,
        config,
        async (args) => {
          commands.push([...args]);
          return {
            stdout:
              args[0] === "docker"
                ? JSON.stringify({
                    os: "linux",
                    architecture: "amd64",
                    config: imageConfig(common.sourceRevision),
                  })
                : JSON.stringify(job),
            stderr: "",
            exitCode: 0,
          };
        },
      );
      expect(result.receipt.uid).toBe(job.metadata.uid);
      expect(commands.map((command) => command[0])).toEqual(["docker", "helm"]);
    } finally {
      await server.stop(true);
    }
  },
);

function forumImage(env: string[], labels: Record<string, string>) {
  return [
    {
      os: "linux" as const,
      architecture: "amd64",
      config: { Env: env, Labels: labels },
    },
  ];
}

test("a Forum image proves its release by baked GIT_SHA or a legacy revision label, plus the recovery ABI", () => {
  const revision = "a".repeat(40);
  const abi = { [FORUM_RECOVERY_IMAGE_LABEL]: FORUM_RECOVERY_IMAGE_ABI };
  expect(
    forumImageProvesRelease(forumImage([`GIT_SHA=${revision}`], abi), revision),
  ).toBe(true);
  expect(
    forumImageProvesRelease(
      forumImage([], { ...abi, "org.opencontainers.image.revision": revision }),
      revision,
    ),
  ).toBe(true);
  expect(
    forumImageProvesRelease(
      forumImage([`GIT_SHA=${"b".repeat(40)}`], abi),
      revision,
    ),
  ).toBe(false);
  expect(
    forumImageProvesRelease(forumImage([`GIT_SHA=${revision}`], {}), revision),
  ).toBe(false);
});

test("manual child is a suspended exact original PodSpec with only fixed intent/action annotations", () => {
  const { job, receipt } = original();
  const child = forumRecoveryChild({
    original: job,
    receipt,
    intentId: "operator/non-uuid",
    action: "repair",
    attempt: 1,
  });
  expect(child.spec?.suspend).toBe(true);
  expect(child.spec?.template.spec).toEqual(job.spec?.template.spec);
  expect(child.spec?.template.metadata?.annotations).toEqual({
    [annotations.intent]: "operator/non-uuid",
    [annotations.action]: "repair",
  });
  expect(child.metadata?.annotations?.[annotations.originalUID]).toBe(
    receipt.uid,
  );
  expect(child.spec?.parallelism).toBe(1);
  expect(child.spec?.completions).toBe(1);
  expect(
    forumRecoveryChild({
      original: job,
      receipt,
      intentId: "operator/non-uuid",
      action: "inspect",
      attempt: 2,
    }).metadata?.name,
  ).not.toBe(child.metadata?.name);
  expect(() =>
    forumRecoveryChild({
      original: {
        ...job,
        metadata: { ...job.metadata, uid: crypto.randomUUID() },
      },
      receipt,
      intentId: "operator/non-uuid",
      action: "repair",
      attempt: 1,
    }),
  ).toThrow("changed");
});

test("a live manual copy or foreign release cannot coexist with native acknowledgement", () => {
  const uid = crypto.randomUUID();
  const owned = {
    metadata: {
      ownerReferences: [
        { apiVersion: "batch/v1", kind: "Job", name: "exact-child", uid },
      ],
    },
    status: { phase: "Running" },
  };
  expect(() =>
    assertNoOtherForumWriter([owned, { status: { phase: "Failed" } }], uid),
  ).not.toThrow();
  for (const phase of ["Running", "Pending", "Unknown"])
    expect(() =>
      assertNoOtherForumWriter(
        [owned, { metadata: { name: "operator-copy" }, status: { phase } }],
        uid,
      ),
    ).toThrow("remains live");
  expect(() => assertNoOtherForumWriter([owned], crypto.randomUUID())).toThrow(
    "remains live",
  );
});

test("execution-policy defaults are normalized but extra parallel writers and altered original Pod bytes change fingerprint", () => {
  const { job } = original();
  expect(
    forumJobFingerprint({
      ...job,
      spec: { ...job.spec, parallelism: 1, completions: 1 },
    }),
  ).toBe(forumJobFingerprint(job));
  for (const changed of [
    { ...job, spec: { ...job.spec, parallelism: 2 } },
    { ...job, spec: { ...job.spec, completions: 2 } },
    { ...job, spec: { ...job.spec, podFailurePolicy: { rules: [] } } },
    {
      ...job,
      spec: {
        ...job.spec,
        template: {
          ...job.spec?.template,
          spec: {
            ...job.spec?.template.spec,
            serviceAccountName: "foreign-account",
          },
        },
      },
    },
    {
      ...job,
      spec: {
        ...job.spec,
        template: {
          ...job.spec?.template,
          spec: {
            ...job.spec?.template.spec,
            containers: [
              {
                name: "release",
                image: "foreign-image",
                env: [{ name: "DB_PASSWORD", value: "injected" }],
              },
            ],
          },
        },
      },
    },
    {
      ...job,
      spec: {
        ...job.spec,
        template: {
          ...job.spec?.template,
          spec: {
            ...job.spec?.template.spec,
            volumes: [{ name: "files", hostPath: { path: "/" } }],
          },
        },
      },
    },
  ])
    expect(forumJobFingerprint(changed)).not.toBe(forumJobFingerprint(job));
});

test("native producer accepts existing operator12 and Delivery32 release identifiers only", () => {
  expect(ForumReleaseIdSchema.parse("a".repeat(12))).toHaveLength(12);
  expect(ForumReleaseIdSchema.parse("b".repeat(32))).toHaveLength(32);
  for (const invalid of [
    "../journal",
    "a".repeat(13),
    "b".repeat(31),
    "G".repeat(32),
  ])
    expect(ForumReleaseIdSchema.safeParse(invalid).success).toBe(false);
});

test("explicit operator acknowledgement is bound into the exact child fingerprint and accepts only one fixed step and journal hash", () => {
  const { job, receipt } = original();
  const input = {
    original: job,
    receipt,
    intentId: "operator/manual",
    action: "repair" as const,
    attempt: 1,
  };
  const child = forumRecoveryChild({
    ...input,
    acknowledgement: { step: "accounts", journalSha256: "d".repeat(64) },
  });
  const action =
    child.spec?.template.metadata?.annotations?.[annotations.action];
  expect(parseForumRecoveryAction(action ?? "")).toEqual({
    action: "repair",
    acknowledgement: { step: "accounts", journalSha256: "d".repeat(64) },
  });
  expect(child.spec?.template.spec).toEqual(job.spec?.template.spec);
  expect(forumJobFingerprint(child)).not.toBe(
    forumJobFingerprint(forumRecoveryChild(input)),
  );
  expect(() =>
    forumRecoveryChild({
      ...input,
      action: "inspect",
      acknowledgement: { step: "accounts", journalSha256: "d".repeat(64) },
    }),
  ).toThrow("explicit Forum repair");
  for (const invalid of [
    "repair:jobs:" + "d".repeat(64),
    "inspect:accounts:" + "d".repeat(64),
    "repair:accounts:bad",
    "repair:accounts:" + "d".repeat(64) + ":extra",
  ])
    expect(() => parseForumRecoveryAction(invalid)).toThrow();
});

/** A compound whose forum Application is second, after an unrelated one. */
const forumCompound = {
  kind: "compound",
  subRecipes: [
    {
      instance: "application:storm-forum-search",
      definition: {
        ...forumRecipe,
        application: {
          ...forumRecipe.application,
          name: "storm-forum-search",
          destination: {
            ...forumRecipe.application.destination,
            namespace: "storm-forum-search",
          },
        },
        steps: forumRecipe.steps
          .filter((step) => step.kind !== "forum-bundle")
          .map((step) => ({
            ...step,
            instance: "application:storm-forum-search",
          })),
      },
    },
    { instance: "application:storm-forum", definition: forumRecipe },
  ],
};

test.each([
  ["an Application recipe", forumRecipe],
  ["a compound's second Application", forumCompound],
])(
  "original Forum recovery of a model release renders the release Job from %s's own chart",
  async (_shape, definition) => {
    const { job } = original();
    const bytes = new TextEncoder().encode("immutable model chart fixture");
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        return new URL(request.url).pathname.startsWith("/charts/")
          ? new Response(bytes)
          : Response.json(job);
      },
    });
    try {
      const chart = {
        ...artifact({
          id: "chart/forum",
          component: "chart:storm-forum",
          kind: "chart",
          uri: `${server.url.origin}/charts/storm-forum-1.0.1.tgz`,
          version: "1.0.1",
          character: "b",
        }),
        digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      };
      const deployment = forumDeployment(definition, [], chart);
      job.metadata.name = `storm-forum-release-${createHash("sha256").update(deployment.deployment.id).digest("hex").slice(0, 32)}`;
      const context = ContentRecoveryContextSchema.parse({
        intent: {
          id: "forum/model-recovery",
          deploymentId: deployment.deployment.id,
          requestedBy: "operator",
          reason: "Inspect the model Forum release's original native Job",
          expectedEnvironmentGeneration: 1,
          snapshotFingerprint: "a".repeat(64),
          status: "pending",
          message: null,
          createdAt: deployment.deployment.createdAt,
          finishedAt: null,
          targetKind: "forum",
        },
        deployment,
        priorDeployment: null,
        expectedSettlements: { desired: "a".repeat(64) },
        recoveryHistory: [],
      });
      const helm: string[][] = [];
      const result = await originalForumRecoveryJob(
        context,
        localKubernetes(server.url.origin),
        async (args) => {
          if (args[0] === "helm") helm.push([...args]);
          return {
            stdout:
              args[0] === "docker"
                ? JSON.stringify({
                    os: "linux",
                    architecture: "amd64",
                    config: {
                      Env: [`GIT_SHA=${"a".repeat(40)}`],
                      Labels: {
                        [FORUM_RECOVERY_IMAGE_LABEL]: FORUM_RECOVERY_IMAGE_ABI,
                      },
                    },
                  })
                : JSON.stringify(job),
            stderr: "",
            exitCode: 0,
          };
        },
      );
      expect(result.receipt).toMatchObject({
        namespace: "storm-forum",
        name: job.metadata.name,
        uid: job.metadata.uid,
      });
      // The forum Application's own chart, in its own namespace.
      expect(helm).toHaveLength(1);
      expect(helm[0]?.slice(0, 2)).toEqual(["helm", "template"]);
      expect(helm[0]?.[2]).toBe("storm-forum");
      expect(helm[0]?.slice(4, 6)).toEqual(["--namespace", "storm-forum"]);
    } finally {
      await server.stop(true);
    }
  },
);
