import {
  CHECKOUT_CONTAINER_ALIAS,
  containerBlock,
  fail,
  hasTrimmedLine,
  requireIncludes,
  sharedPodAnchorBlock,
  SHARED_POD_ANCHORS,
} from "./validate-pipeline-lib.ts";

const EXHAUSTIVE_GRAPH_CAPACITY = [
  "--concurrency=4",
  '{ cpu: "1", memory: "18Gi", ephemeral-storage: "2Gi" }',
  '{ cpu: "7", memory: "24Gi", ephemeral-storage: "40Gi" }',
] as const;

export function validateExhaustiveGraphCapacity(
  source: string,
  lane: string,
): void {
  for (const required of EXHAUSTIVE_GRAPH_CAPACITY) {
    if (!source.includes(required)) {
      fail(`${lane} is missing measured capacity contract ${required}`);
    }
  }
}

function validateReleaseCodexAuthPod(pipeline: string): void {
  const releaseAuthPod = sharedPodAnchorBlock(
    pipeline,
    "pod_release_codex_auth_kubernetes",
  );
  for (const required of [
    "name: buildkite-codex-auth",
    "claimName: buildkite-codex-auth",
    "mountPath: /buildkite/codex-auth",
    "name: CODEX_HOME",
    "value: /buildkite/codex-auth",
  ]) {
    requireIncludes(
      releaseAuthPod,
      required,
      `release Codex auth pod is missing ${required}`,
    );
  }
}

export function validatePipelineResourceContracts(
  pipeline: string,
  stepBlocks: ReadonlyMap<string, string>,
): void {
  const checkoutContainerDefinition = [
    "  - checkout_container: &checkout_container",
    "      name: checkout",
    "      resources:",
    "        # The checkout writes the tracked tree into the memory-backed workspace.",
    '        requests: { cpu: "50m", memory: "1Gi" }',
    '        limits: { cpu: "400m", memory: "2Gi" }',
  ].join("\n");
  if (!pipeline.includes(checkoutContainerDefinition)) {
    fail(
      "checkout container anchor must define the tested CPU and memory budget",
    );
  }

  for (const anchorName of SHARED_POD_ANCHORS) {
    const anchorBlock = sharedPodAnchorBlock(pipeline, anchorName);
    if (!hasTrimmedLine(anchorBlock, CHECKOUT_CONTAINER_ALIAS)) {
      fail(`shared pod anchor ${anchorName} does not patch checkout resources`);
    }
    for (const required of [
      'image: "${CI_BASE_IMAGE}"',
      "imagePullPolicy: IfNotPresent",
    ]) {
      if (!hasTrimmedLine(anchorBlock, required)) {
        fail(
          `shared pod anchor ${anchorName} is missing immutable ${required}`,
        );
      }
    }
  }
  if (pipeline.includes("ghcr.io/shepherdjerred/ci-base:latest")) {
    fail("pipeline restored a mutable ci-base tag");
  }

  const verifyPodAnchor = sharedPodAnchorBlock(
    pipeline,
    "pod_verify_kubernetes",
  );
  validateExhaustiveGraphCapacity(
    `${verifyPodAnchor}\n${stepBlocks.get("verify") ?? ""}`,
    "verify",
  );

  for (const [anchor, requestLine] of [
    [
      "pod_kubernetes",
      'requests: { cpu: "1", memory: "2Gi", ephemeral-storage: "2Gi" }',
    ],
    [
      "pod_buildkit_kubernetes",
      'requests: { cpu: "1", memory: "1Gi", ephemeral-storage: "2Gi" }',
    ],
    [
      "pod_light_kubernetes",
      '{ cpu: "250m", memory: "512Mi", ephemeral-storage: "1Gi" }',
    ],
    [
      "pod_release_codex_auth_kubernetes",
      '{ cpu: "250m", memory: "512Mi", ephemeral-storage: "1Gi" }',
    ],
    [
      "pod_tofu_kubernetes",
      '{ cpu: "250m", memory: "512Mi", ephemeral-storage: "1Gi" }',
    ],
    [
      "pod_pr_dryrun_kubernetes",
      '{ cpu: "250m", memory: "768Mi", ephemeral-storage: "1Gi" }',
    ],
  ] satisfies readonly (readonly [string, string])[]) {
    if (!hasTrimmedLine(sharedPodAnchorBlock(pipeline, anchor), requestLine)) {
      fail(`${anchor} is missing audited command reservation ${requestLine}`);
    }
  }

  for (const [step, anchor] of [
    ["verify", "pod_verify_kubernetes"],
    ["pr-dryrun", "pod_pr_dryrun_kubernetes"],
    ["argocd-sync", "pod_light_kubernetes"],
    ["release-please", "pod_release_codex_auth_kubernetes"],
    ["images-pr", "pod_buildkit_kubernetes"],
    ["images", "pod_buildkit_kubernetes"],
  ] satisfies readonly (readonly [string, string])[]) {
    requireIncludes(
      stepBlocks.get(step),
      `<<: *${anchor}`,
      `${step} must retain audited pod type ${anchor}`,
    );
  }

  const prDryrunAnchor = sharedPodAnchorBlock(
    pipeline,
    "pod_pr_dryrun_kubernetes",
  );
  if (!hasTrimmedLine(prDryrunAnchor, "allowPrivilegeEscalation: false")) {
    fail("pr-dryrun command container permits privilege escalation");
  }

  validateReleaseCodexAuthPod(pipeline);

  for (const step of ["playwright-e2e-pr", "playwright-e2e-main"]) {
    const command = containerBlock(step, stepBlocks.get(step), "container-0");
    if (!hasTrimmedLine(command, 'requests: { cpu: "1", memory: "5Gi" }')) {
      fail(`${step} is missing audited Playwright command reservation`);
    }
  }

  // The Buildkite ConfigMap is reconciled only after a dependency PR merges.
  // Tempo 3 rejects the old `ingester` and `compactor` keys, so each E2E pod
  // must render the backward-compatible live source into an emptyDir before
  // starting its Tempo sidecar. Without this, a Tempo upgrade can never pass
  // the PR build that is meant to approve the ConfigMap migration.
  for (const step of ["docker-e2e-pr", "docker-e2e-main"]) {
    const block = stepBlocks.get(step);
    for (const required of [
      "name: render-tempo-config",
      "mikefarah/yq:latest@sha256:cfc4eee658595834ef304eadb0c3ea721f3b7cb6404ad8b7cb909cc5b5145b23",
      "yq eval 'del(.ingester, .compactor)'",
      "name: llm-observability-e2e-tempo-source",
      "name: llm-observability-e2e-tempo-rendered",
    ]) {
      requireIncludes(
        block,
        required,
        `${step} is missing the Tempo 3 ConfigMap migration bridge ${required}`,
      );
    }
  }

  for (const step of ["trivy", "semgrep"]) {
    const command = containerBlock(step, stepBlocks.get(step), "container-0");
    if (
      !hasTrimmedLine(command, 'requests: { cpu: "250m", memory: "512Mi" }')
    ) {
      fail(`${step} is missing audited scanner command reservation`);
    }
  }

  const alertDashboard = stepBlocks.get("alert-dashboard-sqlite");
  for (const [containerName, requestLine] of [
    ["container-0", '{ cpu: "1", memory: "2Gi", ephemeral-storage: "2Gi" }'],
  ] satisfies readonly (readonly [string, string])[]) {
    if (
      !hasTrimmedLine(
        containerBlock("alert-dashboard-sqlite", alertDashboard, containerName),
        requestLine,
      )
    ) {
      fail(
        `alert-dashboard-sqlite/${containerName} is missing unchanged reservation ${requestLine}`,
      );
    }
  }
}
