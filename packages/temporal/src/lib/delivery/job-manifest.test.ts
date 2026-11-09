import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertMatchingDeliveryJob,
  deliveryJobManifest,
} from "./job-manifest.ts";
import {
  DELIVERY_JOB_BOOTSTRAP,
  PREVIOUS_DELIVERY_JOB_BOOTSTRAPS,
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

it.each(["worker-images", "worker-step", "test"] as const)(
  "prepares only the dependencies needed by %s",
  (recipe) => {
    const preparation = DELIVERY_JOB_BOOTSTRAP.split(
      'export PATH="$(echo "$tool_paths" | paste -sd:):$PATH"\n',
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
          DELIVERY_JOB_REQUEST: JSON.stringify({
            ...request,
            recipe,
            ...(recipe === "test"
              ? { input: { suite: "test", workspace: "packages/delivery" } }
              : {}),
          }),
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim().split("\n").filter(Boolean)).toEqual(
      recipe === "worker-images"
        ? [
            "bun:install --frozen-lockfile --production --filter=@shepherdjerred/temporal",
          ]
        : [
            "bun:install --frozen-lockfile",
            "bunx:turbo run generate --filter=@shepherdjerred/temporal^...",
            "bun:run --cwd packages/llm-models build:runtime",
            "bun:build packages/toolkit/src/index.ts --compile --external ffmpeg-static --outfile=/workspace/bin/toolkit",
            ...(recipe === "test"
              ? ["bunx:turbo run generate --filter={./packages/delivery}..."]
              : []),
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
  it.each(["control-plane"] as const)(
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

describe("persistent stage workspace", () => {
  it.each([
    ["worker-images", "delivery-stage-workspace-production"],
    ["worker-step", "delivery-stage-workspace-full"],
    ["worker-preflight", "delivery-stage-workspace-full"],
    ["test", "delivery-stage-workspace-full"],
    ["tofu-apply", "delivery-stage-workspace-full"],
    ["control-plane", "delivery-stage-workspace-full"],
  ] as const)(
    "mounts %s on the %s claim, chowned once, with ephemeral storage for logs only",
    (recipe, claim) => {
      const spec = deliveryJobManifest({
        ...request,
        recipe,
        stageKey: recipe,
        input:
          recipe === "test"
            ? { suite: "test", workspace: "packages/delivery" }
            : recipe === "tofu-apply"
              ? request.input
              : {},
      }).spec!.template.spec!;
      expect(
        spec.volumes?.find((volume) => volume.name === "workspace"),
      ).toEqual({
        name: "workspace",
        persistentVolumeClaim: { claimName: claim },
      });
      expect(spec.volumes?.some((volume) => volume.emptyDir)).toBe(false);
      expect(spec.securityContext?.fsGroupChangePolicy).toBe("OnRootMismatch");
      expect(spec.containers[0]?.resources).toEqual({
        requests: { cpu: "2", memory: "8Gi", "ephemeral-storage": "32Gi" },
        limits: { cpu: "8", memory: "16Gi", "ephemeral-storage": "32Gi" },
      });
      expect(spec.containers[0]?.securityContext?.readOnlyRootFilesystem).toBe(
        true,
      );
    },
  );
  it("serializes Jobs on the claim and reuses only node_modules from the previous checkout", () => {
    const lines = DELIVERY_JOB_BOOTSTRAP.split("\n");
    const at = (line: string) => {
      const index = lines.indexOf(line);
      if (index === -1) throw new Error(`Bootstrap lacks: ${line}`);
      return index;
    };
    expect(at("flock 9")).toBe(at("exec 9>/workspace/.lock") + 1);
    // Previous scratch goes before anything is prepared; the checkout is
    // forced over the previous one, then stale worktrees and everything
    // untracked except node_modules are removed before the revision check.
    expect(at("rm -rf /workspace/tmp /workspace/bin /workspace/buildx")).toBe(
      at("flock 9") + 1,
    );
    expect(
      at(
        "git -C /workspace/source checkout --quiet --detach --force FETCH_HEAD",
      ),
    ).toBeLessThan(at("git -C /workspace/source worktree prune"));
    expect(at("git -C /workspace/source worktree prune")).toBeLessThan(
      at("git -C /workspace/source clean -fdxq -e node_modules"),
    );
    expect(
      at("git -C /workspace/source clean -fdxq -e node_modules"),
    ).toBeLessThan(
      at(
        'test "$(git -C /workspace/source rev-parse HEAD)" = "$DELIVERY_SOURCE_REVISION"',
      ),
    );
    expect(lines).not.toContain("cp -R /opt/mise/. /workspace/mise/");
    expect(lines).not.toContain("cp -Rs /opt/mise/. /workspace/mise/");
    // Re-linked on every Job over the previous links; only mise's per-tool
    // metadata and alias links become real copies.
    expect(lines).toContain("cp -Rsf /opt/mise/. /workspace/mise/");
    expect(lines).toContain(
      String.raw`(cd /opt/mise && find installs -mindepth 1 -maxdepth 2 ! -type d -exec cp -PT --remove-destination {} /workspace/mise/{} \;)`,
    );
    expect(at("export MISE_DATA_DIR=/workspace/mise")).toBeGreaterThan(
      at("cp -Rsf /opt/mise/. /workspace/mise/"),
    );
  });
  it("adopts a Job with the retired emptyDir workspace layout and nothing else", () => {
    const expected = deliveryJobManifest(request);
    const retired = structuredClone(expected);
    const pod = retired.spec!.template.spec!;
    pod.volumes = pod.volumes!.map((volume) =>
      volume.name === "workspace"
        ? { name: "workspace", emptyDir: { sizeLimit: "32Gi" } }
        : volume,
    );
    pod.containers[0]!.resources = {
      requests: { cpu: "2", memory: "8Gi", "ephemeral-storage": "32Gi" },
      limits: { cpu: "8", memory: "16Gi", "ephemeral-storage": "32Gi" },
    };
    delete pod.securityContext!.fsGroupChangePolicy;
    expect(() => assertMatchingDeliveryJob(retired, expected)).not.toThrow();
    for (const mutate of [
      (spec: typeof pod) => {
        spec.volumes!.find((volume) => volume.name === "workspace")!.emptyDir =
          { sizeLimit: "64Gi" };
      },
      (spec: typeof pod) => {
        spec.containers[0]!.resources!.limits!["ephemeral-storage"] = "64Gi";
      },
      (spec: typeof pod) => {
        spec.securityContext!.fsGroupChangePolicy = "Always";
      },
      (spec: typeof pod) => {
        spec.volumes!.find((volume) => volume.name === "workspace")!.emptyDir =
          { sizeLimit: "32Gi", medium: "Memory" };
      },
    ]) {
      const altered = structuredClone(retired);
      mutate(altered.spec!.template.spec!);
      expect(() => assertMatchingDeliveryJob(altered, expected)).toThrow(
        "frozen request",
      );
    }
  });
  it("adopts a Job created with a previous reviewed bootstrap and nothing else", () => {
    // The exact bootstraps that created Jobs before: the fresh emptyDir
    // workspace, then linked toolchains with no test or stack-archive step,
    // then the copied toolchain. A changed digest means a retained Job could
    // no longer be adopted.
    expect(
      PREVIOUS_DELIVERY_JOB_BOOTSTRAPS.map((script) =>
        createHash("sha256").update(script).digest("hex"),
      ),
    ).toEqual([
      "7fcc3559847d7a436fa42cdf5d4755bb357c8b789a4a665822556828c3e3434d",
      "011b625607e3c62d719e77b388dd7f80414dac3f609f317c8c7285738b9ff9a2",
      "a5c909be28ebe8674710740bf59914338db047cb7831571023c3be7ddb9c7c15",
    ]);
    for (const recipe of [
      "worker-images",
      "worker-step",
      "tofu-apply",
    ] as const) {
      const expected = deliveryJobManifest({ ...request, recipe });
      expect(expected.spec?.template.spec?.containers[0]?.command).toEqual([
        "/bin/bash",
        "-c",
        DELIVERY_JOB_BOOTSTRAP,
      ]);
      for (const previous of PREVIOUS_DELIVERY_JOB_BOOTSTRAPS) {
        const adopted = structuredClone(expected);
        adopted.spec!.template.spec!.containers[0]!.command = [
          "/bin/bash",
          "-c",
          previous,
        ];
        expect(() =>
          assertMatchingDeliveryJob(adopted, expected),
        ).not.toThrow();
      }
      const legacy = structuredClone(expected);
      legacy.spec!.template.spec!.containers[0]!.command = [
        "/bin/bash",
        "-c",
        PREVIOUS_DELIVERY_JOB_BOOTSTRAPS[0]!,
      ];
      const legacyChanged = structuredClone(legacy);
      legacyChanged.spec!.template.spec!.containers[0]!.env!.push({
        name: "UNREVIEWED",
        value: "1",
      });
      expect(() => assertMatchingDeliveryJob(legacyChanged, expected)).toThrow(
        "frozen request",
      );
      const edited = structuredClone(expected);
      edited.spec!.template.spec!.containers[0]!.command = [
        "/bin/bash",
        "-c",
        `${PREVIOUS_DELIVERY_JOB_BOOTSTRAPS[0]!}echo unreviewed\n`,
      ];
      expect(() => assertMatchingDeliveryJob(edited, expected)).toThrow(
        "frozen request",
      );
    }
  });
});

describe("Delivery test-suite Jobs (V5)", () => {
  it("runs a test suite as a tokenless worker-namespace Job with no grants", () => {
    const job = deliveryJobManifest({
      ...request,
      recipe: "test",
      stageKey: "test-e2e",
      input: { suite: "test:e2e", workspace: "packages/delivery" },
    });
    expect(job.metadata?.namespace).toBe("delivery-worker-jobs");
    expect(job.metadata?.labels).toMatchObject({
      app: "delivery-stage",
      "kueue.x-k8s.io/queue-name": "delivery",
    });
    const spec = job.spec!.template.spec!;
    expect(spec.nodeSelector).toEqual({ "kubernetes.io/hostname": "liskov" });
    expect(spec.automountServiceAccountToken).toBe(false);
    expect(
      spec.containers[0]?.env?.filter((entry) => entry.valueFrom !== undefined),
    ).toEqual([]);
    expect(
      spec.containers[0]?.env?.some(
        (entry) => entry.name === "DELIVERY_API_URL",
      ),
    ).toBe(false);
  });
});

describe("runtime image", () => {
  it("ships every homelab module the manifest builder imports", async () => {
    const source = await Bun.file(
      new URL("job-manifest.ts", import.meta.url),
    ).text();
    const dockerfile = await Bun.file(
      new URL("../../../Dockerfile", import.meta.url),
    ).text();
    const imported = [...source.matchAll(/from "homelab\/([^"]+)"/g)].map(
      (match) => `packages/homelab/${match[1] ?? ""}`,
    );
    expect(imported).toContain(
      "packages/homelab/src/delivery-stage-admission.ts",
    );
    for (const path of imported) {
      expect(dockerfile).toContain(`\n  ${path} \\\n`);
    }
  });
});
