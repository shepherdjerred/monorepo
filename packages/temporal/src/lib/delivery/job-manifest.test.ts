import { describe, expect, it } from "vitest";
import {
  assertMatchingDeliveryJob,
  deliveryJobManifest,
} from "./job-manifest.ts";
import {
  DELIVERY_JOB_BOOTSTRAP,
  type DeliveryJobRequest,
} from "#shared/delivery-job.ts";
import { DELIVERY_STAGE_REQUESTS } from "homelab/src/delivery-stage-admission.ts";

const request: DeliveryJobRequest = {
  deploymentId: "deployment-42",
  stageKey: "tofu-apply",
  recipe: "tofu-apply",
  runnerImage: `docker.io/shepherdjerred/ci-base@sha256:${"a".repeat(64)}`,
  sourceRevision: "b".repeat(40),
  input: { stack: "github", proof: { a: 1, b: 2 } },
};

it.each(["worker-images", "worker-step"] as const)(
  "prepares only the dependencies needed by %s",
  (recipe) => {
    const preparation = DELIVERY_JOB_BOOTSTRAP.split(
      "bun install --frozen-lockfile\n",
    )[1]?.split("cd packages/temporal\n")[0];
    if (preparation === undefined) throw new Error("Missing Job preparation");
    const result = Bun.spawnSync(
      [
        "bash",
        "-c",
        String.raw`set -euo pipefail
bun() { printf 'bun:%s\n' "$*"; }
bunx() { printf 'bunx:%s\n' "$*"; }
${preparation}`,
      ],
      {
        env: {
          PATH: Bun.env["PATH"],
          DELIVERY_JOB_REQUEST: JSON.stringify({ ...request, recipe }),
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim().split("\n").filter(Boolean)).toEqual(
      recipe === "worker-images"
        ? []
        : [
            "bunx:turbo run generate --filter=@shepherdjerred/temporal^...",
            "bun:run --cwd packages/llm-models build:runtime",
            "bun:build packages/toolkit/src/index.ts --compile --external ffmpeg-static --outfile=/workspace/bin/toolkit",
          ],
    );
  },
);

it("mounts the namespace-only readonly API token solely in fixed recovery recipes and accepts only known Kubernetes defaults", () => {
  const job = deliveryJobManifest({
    ...request,
    recipe: "platform-recovery",
    stageKey: "platform-recovery-inspect-1",
    input: {
      intentId: request.deploymentId,
      action: "inspect",
      attempt: 1,
      expectedEnvironmentGeneration: 1,
      snapshotFingerprint: "c".repeat(64),
      target: "control-plane",
    },
  });
  const spec = job.spec!.template.spec!;
  expect(spec.serviceAccountName).toBe("delivery-recovery-inspector");
  expect(spec.automountServiceAccountToken).toBe(false);
  expect(
    spec.volumes?.find((volume) => volume.name === "kubernetes")?.projected
      ?.sources,
  ).toHaveLength(3);
  expect(
    spec.containers[0]?.env
      ?.filter((entry) => entry.valueFrom?.secretKeyRef !== undefined)
      .map((entry) => entry.valueFrom?.secretKeyRef?.name),
  ).toEqual(["delivery-platform-api", "delivery-platform-argocd"]);
  const observed = structuredClone(job);
  observed.spec!.template.spec!.serviceAccount = "delivery-recovery-inspector";
  const token = observed.spec!.template.spec!.volumes!.find(
    (volume) => volume.name === "kubernetes",
  )!;
  token.projected!.defaultMode = 420;
  const reference = token.projected!.sources!.find(
    (entry) => entry.downwardAPI !== undefined,
  )!.downwardAPI!.items![0]!.fieldRef!;
  reference.apiVersion = "v1";
  const uid = observed.spec!.template.spec!.containers[0]!.env!.find(
    (entry) => entry.name === "DELIVERY_JOB_UID",
  )!;
  uid.valueFrom!.fieldRef!.apiVersion = "v1";
  expect(() => assertMatchingDeliveryJob(observed, job)).not.toThrow();
  reference.fieldPath = "metadata.name";
  expect(() => assertMatchingDeliveryJob(observed, job)).toThrow(
    "frozen request",
  );
  expect(
    deliveryJobManifest(request).spec!.template.spec!.volumes!.some(
      (volume) => volume.projected !== undefined,
    ),
  ).toBe(false);
});
describe("bounded revision-pinned Delivery Jobs", () => {
  it("isolates readonly worker recipes from platform provider credentials and namespaces", () => {
    const worker = deliveryJobManifest({
      ...request,
      recipe: "worker-images",
      stageKey: "worker-image-provenance",
      input: {},
    });
    expect(worker.metadata?.namespace).toBe("delivery-worker-jobs");
    expect(worker.spec?.template.spec).toMatchObject({
      serviceAccountName: "delivery-stage",
      automountServiceAccountToken: false,
      securityContext: {
        runAsNonRoot: true,
        seccompProfile: { type: "RuntimeDefault" },
      },
    });
    expect(
      worker.spec?.template.spec?.containers[0]?.env?.filter(
        (entry) => entry.valueFrom !== undefined,
      ),
    ).toEqual([]);
    expect(
      worker.spec?.template.spec?.volumes
        ?.filter((volume) => volume.secret !== undefined)
        .map((volume) => volume.secret?.secretName),
    ).toEqual(["dockerhub-pull-delivery-worker-jobs"]);
    expect(
      worker.spec?.template.spec?.containers[0]?.env?.filter((entry) =>
        ["DOCKER_CONFIG", "BUILDX_CONFIG"].includes(entry.name),
      ),
    ).toEqual([
      { name: "DOCKER_CONFIG", value: "/var/run/delivery/docker" },
      { name: "BUILDX_CONFIG", value: "/workspace/buildx" },
    ]);
    const platform = deliveryJobManifest(request);
    expect(platform.metadata?.namespace).toBe("delivery-platform-jobs");
    const transplanted = structuredClone(worker);
    transplanted.metadata!.namespace = "delivery-platform-jobs";
    expect(() => assertMatchingDeliveryJob(transplanted, worker)).toThrow(
      "frozen request",
    );
  });
  it("gives equivalent PostgreSQL JSON a stable identity and requires exact execution inputs", () => {
    const expected = deliveryJobManifest(request);
    const reordered = deliveryJobManifest({
      ...request,
      input: { proof: { b: 2, a: 1 }, stack: "github" },
    });
    expect(reordered.metadata?.name).toBe(expected.metadata?.name);
    expect(() => assertMatchingDeliveryJob(reordered, expected)).not.toThrow();
    const changed = deliveryJobManifest({
      ...request,
      sourceRevision: "c".repeat(40),
    });
    expect(changed.metadata?.name).not.toBe(expected.metadata?.name);
  });
  it("queues on Delivery's reserved LocalQueue and still adopts Jobs queued with CI", () => {
    const expected = deliveryJobManifest(request);
    expect(expected.metadata?.labels?.["kueue.x-k8s.io/queue-name"]).toBe(
      "delivery",
    );
    expect(
      expected.spec?.template.spec?.containers[0]?.resources?.requests,
    ).toEqual(DELIVERY_STAGE_REQUESTS);
    const legacy = structuredClone(expected);
    legacy.metadata!.labels!["kueue.x-k8s.io/queue-name"] = "default";
    expect(() => assertMatchingDeliveryJob(legacy, expected)).not.toThrow();
    for (const mutate of [
      (labels: Record<string, string>) => {
        labels["kueue.x-k8s.io/queue-name"] = "ci-gates";
      },
      (labels: Record<string, string>) => {
        delete labels["kueue.x-k8s.io/queue-name"];
      },
    ]) {
      const unqueued = structuredClone(expected);
      mutate(unqueued.metadata!.labels!);
      expect(() => assertMatchingDeliveryJob(unqueued, expected)).toThrow(
        "frozen request",
      );
    }
  });
  it.each(["control-plane", "root-release"] as const)(
    "keeps %s in an independent tokenless platform Job with only its fixed transport grants",
    (recipe) => {
      const job = deliveryJobManifest({
        ...request,
        recipe,
        stageKey: recipe,
        input: {},
      });
      expect(job.metadata?.namespace).toBe("delivery-platform-jobs");
      expect(job.spec?.template.spec?.automountServiceAccountToken).toBe(false);
      const env = job.spec!.template.spec!.containers[0]!.env!;
      expect(
        env
          .filter((entry) => entry.valueFrom?.secretKeyRef !== undefined)
          .map((entry) => entry.valueFrom!.secretKeyRef),
      ).toEqual([
        { name: "delivery-platform-argocd", key: "ARGOCD_TOKEN" },
        { name: "delivery-platform-api", key: "DELIVERY_EXECUTOR_TOKEN" },
      ]);
      expect(
        env.find((entry) => entry.name === "DELIVERY_API_URL")?.value,
      ).toBe("http://delivery.delivery.svc.cluster.local:7353");
      expect(
        env.some(
          (entry) => entry.name === "DELIVERY_PLAN_ENCRYPTION_PASSPHRASE",
        ),
      ).toBe(false);
    },
  );
  it("rejects adopted Jobs with credential, resource, shell, volume or security changes", () => {
    const expected = deliveryJobManifest(request);
    for (const mutate of [
      (job: ReturnType<typeof deliveryJobManifest>) => {
        job.spec!.template.spec!.containers[0]!.command = [
          "sh",
          "-c",
          "unreviewed",
        ];
      },
      (job: ReturnType<typeof deliveryJobManifest>) => {
        job.spec!.template.spec!.containers[0]!.env!.push({
          name: "OP_SERVICE_ACCOUNT_TOKEN",
          value: "forbidden",
        });
      },
      (job: ReturnType<typeof deliveryJobManifest>) => {
        job.spec!.template.spec!.containers[0]!.resources = {
          requests: { cpu: "100" },
        };
      },
      (job: ReturnType<typeof deliveryJobManifest>) => {
        job.spec!.template.spec!.volumes!.push({
          name: "vault",
          secret: { secretName: "operator" },
        });
      },
      (job: ReturnType<typeof deliveryJobManifest>) => {
        job.spec!.template.spec!.automountServiceAccountToken = true;
      },
    ]) {
      const altered = structuredClone(expected);
      mutate(altered);
      expect(() => assertMatchingDeliveryJob(altered, expected)).toThrow(
        "frozen request",
      );
    }
  });
  it("projects individual scoped keys and refuses operator-only platform recipes", () => {
    const job = deliveryJobManifest(request);
    const spec = job.spec!.template.spec!;
    expect(job.spec).toMatchObject({
      suspend: true,
      backoffLimit: 0,
      activeDeadlineSeconds: 7200,
    });
    expect(spec).toMatchObject({
      automountServiceAccountToken: false,
      nodeSelector: { "kubernetes.io/hostname": "liskov" },
    });
    const env = spec.containers[0]!.env!;
    expect(
      env
        .filter((entry) => entry.valueFrom !== undefined)
        .map((entry) => entry.name)
        .sort(),
    ).toEqual([
      "DELIVERY_EXECUTOR_TOKEN",
      "DELIVERY_JOB_UID",
      "DELIVERY_PLAN_ENCRYPTION_PASSPHRASE",
      "SEAWEEDFS_TOFU_STATE_ACCESS_KEY_ID",
      "SEAWEEDFS_TOFU_STATE_SECRET_ACCESS_KEY",
      "TOFU_GITHUB_TOKEN",
    ]);
    expect(() =>
      deliveryJobManifest({ ...request, input: { stack: "argocd" } }),
    ).toThrow("no Delivery provider grant");
    const plan = deliveryJobManifest({ ...request, recipe: "tofu-plan" });
    expect(
      plan.spec?.template.spec?.containers[0]?.env?.some(
        (entry) => entry.name === "DELIVERY_EXECUTOR_TOKEN",
      ),
    ).toBe(false);
    expect(
      env.find((entry) => entry.name === "DELIVERY_EXECUTOR_TOKEN")?.valueFrom,
    ).toEqual({
      secretKeyRef: {
        name: "delivery-platform-api",
        key: "DELIVERY_EXECUTOR_TOKEN",
      },
    });
  });
});
