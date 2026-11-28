import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertMatchingDeliveryJob,
  deliveryJobManifest,
} from "./job-manifest.ts";
import {
  DELIVERY_JOB_BOOTSTRAP,
  DELIVERY_JOB_FULL_TOOLS,
  DELIVERY_JOB_IMAGE_PROVENANCE_TOOLS,
  type DeliveryJobRequest,
} from "#shared/delivery-job.ts";
import { PREVIOUS_DELIVERY_JOB_BOOTSTRAPS } from "./previous-job-bootstraps.ts";
import { DELIVERY_STAGE_REQUESTS } from "homelab/src/delivery-stage-admission.ts";

const request: DeliveryJobRequest = {
  deploymentId: "deployment-42",
  stageKey: "tofu-apply",
  recipe: "tofu-apply",
  runnerImage: `docker.io/shepherdjerred/ci-base@sha256:${"a".repeat(64)}`,
  sourceRevision: "b".repeat(40),
  input: { stack: "github", proof: { a: 1, b: 2 } },
};

const TOOL_INSTALL_START = "MISE_LOCKED=1 mise install --yes jq\n";
const TOOL_PATH_EXPORT =
  'export PATH="$(echo "$tool_paths" | paste -sd:):$PATH"\n';

/**
 * Runs the bootstrap from the first mise install onward with fake tools. The
 * fake prepared-outputs `restore` reports a miss unless `restored` is set, and
 * the fake `git status` prints `trackedStatus`.
 */
function spawnPreparation(
  jobRequest: DeliveryJobRequest,
  stopAfter: string | undefined,
  restored = false,
  trackedStatus = "",
) {
  const start = DELIVERY_JOB_BOOTSTRAP.indexOf(TOOL_INSTALL_START);
  if (start === -1) throw new Error("Missing tool installation");
  const end =
    stopAfter === undefined
      ? DELIVERY_JOB_BOOTSTRAP.indexOf("cd packages/temporal\n")
      : DELIVERY_JOB_BOOTSTRAP.indexOf(stopAfter) + stopAfter.length;
  const preparation = DELIVERY_JOB_BOOTSTRAP.slice(start, end);
  const result = Bun.spawnSync(
    [
      "bash",
      "-c",
      String.raw`set -euo pipefail
bun() {
  printf 'bun:%s\n' "$*"
  case "$*" in *prepared-outputs.ts\ restore\ *) return "$FAKE_RESTORE_EXIT" ;; esac
}
bunx() { printf 'bunx:%s\n' "$*"; }
rm() { printf 'rm:%s\n' "$*"; }
touch() { printf 'touch:%s\n' "$*"; }
# Only the post-restore clean-tree check runs Git here; its output is captured.
git() {
  case "$*" in "status --porcelain=v1 --untracked-files=no") printf '%s' "$FAKE_TRACKED_STATUS" ;; *) exit 64 ;; esac
}
# BSD paste (macOS) needs an operand where the GNU paste in the image reads stdin.
paste() { tr '\n' ':' | sed 's/:$//'; echo; }
mise() {
  case "$1" in
    install) printf 'mise-install(MISE_LOCKED=%s):%s\n' "$MISE_LOCKED" "$*" ;;
    bin-paths) shift; printf '/fake/mise/%s/bin\n' "$@" ;;
    *) exit 64 ;;
  esac
}
${preparation}`,
    ],
    {
      env: {
        PATH: Bun.env["PATH"],
        DELIVERY_JOB_REQUEST: JSON.stringify(jobRequest),
        DELIVERY_SOURCE_REVISION: jobRequest.sourceRevision,
        FAKE_RESTORE_EXIT: restored ? "0" : "1",
        FAKE_TRACKED_STATUS: trackedStatus,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString().trim().split("\n").filter(Boolean),
    stderr: result.stderr.toString(),
  };
}

function runPreparation(
  jobRequest: DeliveryJobRequest,
  stopAfter: string | undefined,
  restored = false,
) {
  const result = spawnPreparation(jobRequest, stopAfter, restored);
  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
  return result.stdout;
}

/** The `mise install` invocations the bootstrap makes for a Job request. */
const install = (jobRequest: DeliveryJobRequest) =>
  runPreparation(jobRequest, TOOL_PATH_EXPORT).filter((line) =>
    line.startsWith("mise-install"),
  );

/** The preparation commands after tool installation, with the prepared-outputs key elided. */
const prepared = (recipe: DeliveryJobRequest["recipe"], restored: boolean) =>
  runPreparation(
    {
      ...request,
      recipe,
      ...(recipe === "test"
        ? { input: { suite: "test", workspace: "packages/delivery" } }
        : {}),
    },
    undefined,
    restored,
  )
    .filter((line) => !line.startsWith("mise-install"))
    .map((line) => line.replace(/\b[a-f0-9]{64}\b/u, "<key>"));
/** The prepared-outputs key the bootstrap computes for a request. */
const preparedKey = (jobRequest: DeliveryJobRequest) =>
  runPreparation(jobRequest, undefined)
    .find((line) => line.includes("prepared-outputs.ts restore"))
    ?.split(" ")
    .at(-1);
const GENERATE = [
  "rm:-rf /workspace/prepared",
  "bunx:turbo run generate --filter=@shepherdjerred/temporal^...",
  "bun:run --cwd packages/llm-models build:runtime",
  "bun:build packages/toolkit/src/index.ts --compile --external ffmpeg-static --outfile=/workspace/bin/toolkit",
];

/** The install, bracketed by its completion marker (DELIVERY_JOB_INSTALL_MARKER). */
const INSTALL = (command: string) => [
  "rm:-f .git/delivery-install-complete",
  command,
  "touch:.git/delivery-install-complete",
];

describe("prepared dependencies and outputs", () => {
  it("installs only the Temporal runtime closure for image provenance", () => {
    for (const restored of [false, true])
      expect(prepared("worker-images", restored)).toEqual(
        INSTALL(
          "bun:install --frozen-lockfile --production --filter=@shepherdjerred/temporal",
        ),
      );
  });
  it("generates, builds and keeps the outputs when no kept outputs match", () => {
    expect(prepared("worker-step", false)).toEqual([
      ...INSTALL("bun:install --frozen-lockfile"),
      "bun:packages/temporal/scripts/jobs/prepared-outputs.ts restore <key>",
      ...GENERATE,
      "bun:packages/temporal/scripts/jobs/prepared-outputs.ts keep <key>",
    ]);
  });
  it("skips generation, the runtime build and the toolkit compile when kept outputs are restored", () => {
    expect(prepared("worker-step", true)).toEqual([
      ...INSTALL("bun:install --frozen-lockfile"),
      "bun:packages/temporal/scripts/jobs/prepared-outputs.ts restore <key>",
    ]);
  });
  it("fails the Job and discards the kept outputs when a restore changed a tracked file", () => {
    const result = spawnPreparation(
      { ...request, recipe: "worker-step" },
      undefined,
      true,
      " M packages/temporal/package.json",
    );
    expect(result.exitCode).toBe(1);
    expect(
      result.stdout
        .filter((line) => !line.startsWith("mise-install"))
        .map((line) => line.replace(/\b[a-f0-9]{64}\b/u, "<key>")),
    ).toEqual([
      ...INSTALL("bun:install --frozen-lockfile"),
      "bun:packages/temporal/scripts/jobs/prepared-outputs.ts restore <key>",
      "rm:-rf /workspace/prepared",
    ]);
    expect(JSON.parse(result.stderr)).toMatchObject({
      kind: "delivery-stage-workspace",
      event: "prepared-outputs-reset",
    });
  });
  it("always regenerates for a test recipe and keeps nothing it generated", () => {
    for (const restored of [false, true])
      expect(prepared("test", restored)).toEqual([
        ...INSTALL("bun:install --frozen-lockfile"),
        ...GENERATE,
        "bunx:turbo run generate --filter={./packages/delivery}...",
      ]);
  });
  it("keys kept outputs by the revision, the runner image and the bootstrap", () => {
    const base = preparedKey({ ...request, recipe: "worker-step" });
    expect(base).toMatch(/^[a-f0-9]{64}$/u);
    // Every full-install recipe of one revision shares the kept outputs.
    expect(preparedKey({ ...request, recipe: "worker-preflight" })).toBe(base);
    expect(
      preparedKey({
        ...request,
        recipe: "worker-step",
        sourceRevision: "c".repeat(40),
      }),
    ).not.toBe(base);
    expect(
      preparedKey({
        ...request,
        recipe: "worker-step",
        runnerImage: `docker.io/shepherdjerred/ci-base@sha256:${"d".repeat(64)}`,
      }),
    ).not.toBe(base);
    expect(DELIVERY_JOB_BOOTSTRAP).toContain(
      String.raw`prepared_key=$(printf '%s\n' "$DELIVERY_SOURCE_REVISION" "$(jq -er '.runnerImage' <<< "$DELIVERY_JOB_REQUEST")" "$BASH_EXECUTION_STRING" | sha256sum | cut -d' ' -f1)`,
    );
  });
});

describe("Job tool installation under the checked-out revision's lockfile", () => {
  // A retained executor's revision can predate the CI image's pins. Locked
  // mode installs a tool version the image lacks only from a checksum that
  // revision's mise.lock records, and awscli's linux-x64 entry has none before
  // 2.41, so awscli is installed only for the recipes that run `aws`.
  it("installs only jq, bun, node and helm for image provenance, under MISE_LOCKED", () => {
    expect(install({ ...request, recipe: "worker-images" })).toEqual([
      "mise-install(MISE_LOCKED=1):install --yes jq",
      "mise-install(MISE_LOCKED=1):install --yes bun node jq helm",
    ]);
    expect(DELIVERY_JOB_IMAGE_PROVENANCE_TOOLS.split(" ")).not.toContain(
      "awscli",
    );
  });
  it.each([
    "worker-preflight",
    "worker-step",
    "test",
    "control-plane",
    "platform-recovery",
  ] as const)("installs no awscli for %s without a stack archive", (recipe) => {
    expect(install({ ...request, recipe, input: {} })).toEqual([
      "mise-install(MISE_LOCKED=1):install --yes jq",
      `mise-install(MISE_LOCKED=1):install --yes ${DELIVERY_JOB_FULL_TOOLS}`,
    ]);
    expect(DELIVERY_JOB_FULL_TOOLS.split(" ")).not.toContain("awscli");
  });
  it.each(["tofu-plan", "tofu-apply"] as const)(
    "installs awscli for %s, whose stacks run aws in local-exec provisioners",
    (recipe) => {
      expect(install({ ...request, recipe, input: {} })).toEqual([
        "mise-install(MISE_LOCKED=1):install --yes jq",
        `mise-install(MISE_LOCKED=1):install --yes ${DELIVERY_JOB_FULL_TOOLS} awscli`,
      ]);
    },
  );
  it("installs awscli for any recipe that downloads a stack archive", () => {
    expect(
      install({
        ...request,
        recipe: "control-plane",
        input: {
          stack: "github",
          archive: {
            uri: "s3://delivery-artifacts/stack.tar",
            digest: `sha256:${"c".repeat(64)}`,
          },
        },
      }),
    ).toEqual([
      "mise-install(MISE_LOCKED=1):install --yes jq",
      `mise-install(MISE_LOCKED=1):install --yes ${DELIVERY_JOB_FULL_TOOLS} awscli`,
    ]);
  });
  it("keeps every install locked and never relaxes checksum verification", () => {
    expect(DELIVERY_JOB_BOOTSTRAP.match(/mise install/gu)).toHaveLength(2);
    expect(
      DELIVERY_JOB_BOOTSTRAP.match(/MISE_LOCKED=1 mise install/gu),
    ).toHaveLength(2);
    expect(DELIVERY_JOB_BOOTSTRAP).not.toMatch(
      /MISE_LOCKED=0|--no-lock|unlocked/u,
    );
  });
});

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
  it("serializes Jobs on the claim and keeps only verified objects, node_modules and verified outputs", () => {
    const lines = DELIVERY_JOB_BOOTSTRAP.split("\n");
    const at = (line: string) => {
      const index = lines.indexOf(line);
      if (index === -1) throw new Error(`Bootstrap lacks: ${line}`);
      return index;
    };
    const order = (...expected: string[]) => {
      const indexes = expected.map((line) => at(line));
      expect(indexes).toEqual(indexes.toSorted((a, b) => a - b));
    };
    expect(at("flock 9")).toBe(at("exec 9>/workspace/.lock") + 1);
    // Previous scratch goes before anything is prepared.
    expect(
      at(
        "rm -rf /workspace/tmp /workspace/bin /workspace/buildx /workspace/stack",
      ),
    ).toBe(at("flock 9") + 1);
    // The store keeps only objects, its shallow boundary and the negotiation
    // ref, which must pass fsck before anything is fetched into it; the
    // checkout's own repository is new for every Job and borrows the store.
    order(
      "export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1",
      "previous=",
      "[ ! -f /workspace/git/refs/heads/delivery-checkout ] || previous=$(cat /workspace/git/refs/heads/delivery-checkout)",
      "find /workspace/git -mindepth 1 -maxdepth 1 ! -name objects ! -name shallow -exec rm -rf {} +",
      "rm -rf /workspace/git/objects/info",
      "find /workspace/git/objects/pack -type f ! -name 'pack-*.idx' ! -name 'pack-*.pack' -delete",
      "git init -q --bare --initial-branch=delivery-checkout /workspace/git",
      'if [ -n "$previous" ] && ! { [[ $previous =~ ^[0-9a-f]{40}$ ]] && git --git-dir=/workspace/git update-ref refs/heads/delivery-checkout "$previous" && git --git-dir=/workspace/git fsck --full --no-dangling --no-progress; }; then',
      `  echo '{"kind":"delivery-stage-workspace","event":"git-store-reset","detail":"the kept Git object store failed verification; this Job fetches a fresh one"}' >&2`,
      "  rm -rf /workspace/git",
      'git --git-dir=/workspace/git fetch --quiet --no-tags --no-auto-maintenance --depth=1 https://github.com/shepherdjerred/monorepo.git "$DELIVERY_SOURCE_REVISION"',
      'git --git-dir=/workspace/git update-ref refs/heads/delivery-checkout "$DELIVERY_SOURCE_REVISION"',
      // Whether node_modules is a completed install is read before .git,
      // which holds that marker, is replaced.
      "installed=",
      "[ ! -f /workspace/source/.git/delivery-install-complete ] || installed=1",
      "rm -rf /workspace/source/.git",
      "git init -q /workspace/source",
      '[ -z "$installed" ] || touch /workspace/source/.git/delivery-install-complete',
      "git -C /workspace/source config core.attributesFile /dev/null",
      "echo /workspace/git/objects >/workspace/source/.git/objects/info/alternates",
      // An index with no stat data: every tracked file's exact bytes are
      // hashed against the revision; untracked files (a stray .gitattributes
      // among them) go before the reset rewrites only the differing files
      // with the revision's own attributes.
      'git -C /workspace/source update-ref --no-deref HEAD "$DELIVERY_SOURCE_REVISION"',
      "git -C /workspace/source read-tree HEAD",
      "echo '* -text -filter -ident -working-tree-encoding' >/workspace/source/.git/info/attributes",
      "git -C /workspace/source update-index -q --refresh",
      "rm /workspace/source/.git/info/attributes",
      'if [ -n "$installed" ]; then',
      "  git -C /workspace/source clean -ffdxq -e node_modules",
      "  git -C /workspace/source clean -ffdxq",
      // git clean never lists a .git under a tracked directory.
      String.raw`find /workspace/source -mindepth 1 \( -path /workspace/source/.git -o -name node_modules \) -prune -o -name .git -prune -exec rm -rf {} +`,
      "git -C /workspace/source reset -q --hard",
      'test "$(git -C /workspace/source rev-parse HEAD)" = "$DELIVERY_SOURCE_REVISION"',
      'test -z "$(git -C /workspace/source status --porcelain=v1 --untracked-files=no)"',
      "  git --git-dir=/workspace/git -c repack.writeBitmaps=false repack -a -d -q",
      "git --git-dir=/workspace/git prune --expire=now",
      "cd /workspace/source",
    );
    expect(DELIVERY_JOB_BOOTSTRAP).not.toContain("checkout --quiet");
    expect(DELIVERY_JOB_BOOTSTRAP).not.toContain("FETCH_HEAD");
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
});

describe("adopting Jobs of earlier stage workspace layouts", () => {
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
    // then the copied toolchain, then the repository that kept every fetched
    // revision, then the stack archive extracted over the previous one, then the
    // full tool set with awscli installed for every recipe, then the fresh
    // repository that fetched the whole tree for every Job. A
    // changed digest means a retained Job could no longer be adopted.
    expect(
      PREVIOUS_DELIVERY_JOB_BOOTSTRAPS.map((script) =>
        createHash("sha256").update(script).digest("hex"),
      ),
    ).toEqual([
      "7fcc3559847d7a436fa42cdf5d4755bb357c8b789a4a665822556828c3e3434d",
      "011b625607e3c62d719e77b388dd7f80414dac3f609f317c8c7285738b9ff9a2",
      "a5c909be28ebe8674710740bf59914338db047cb7831571023c3be7ddb9c7c15",
      "3fd9e4b9b8d049d2c56fabbf38f78eff2f10eeebfccd8419e97f98bcd85cb40a",
      "99e8cdfb302e6f2eb709ae86fd55b1bfd396008f6bb54186de14ae7b4f9920cd",
      "6fd3b334472369b36e0765e45b7a0d1d0c3afce213ce8a2f8f93f987eff3c2bb",
      "be234cbc4a7e76b69e3b1ac1216b46a5f137c14c829f8545ef18e892a56f19cc",
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

describe("native addon cache", () => {
  it("gives @swc/core a private cache on the pod workspace", () => {
    const env =
      deliveryJobManifest(request).spec?.template.spec?.containers[0]?.env;
    expect(
      env?.filter((entry) => entry.name.startsWith("SWC_NATIVE_BINDING_CACHE")),
    ).toEqual([
      { name: "SWC_NATIVE_BINDING_CACHE", value: "/workspace/home/.cache" },
      { name: "SWC_NATIVE_BINDING_CACHE_SKIP_SECURITY_CHECK", value: "1" },
    ]);
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
