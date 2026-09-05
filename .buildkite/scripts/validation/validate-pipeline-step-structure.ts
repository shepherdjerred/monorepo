// Per-step structural checks driven by collectStepBlocks in
// validate-pipeline-lib.ts, split out to keep that file under the max-lines
// budget. This file only holds the native-vs-Kubernetes step shape checks and
// the shared if_changed-gate check; generic text parsing stays in
// validate-pipeline-lib.ts.

import { fail, hasTrimmedLine, scalar } from "./validate-pipeline-parse.ts";

export type StepStructureConfig = {
  sharedPodAnchors: readonly string[];
  checkoutContainerAlias: string;
  pathGatedPrKeys: ReadonlySet<string>;
  nativeStepKeys: ReadonlySet<string>;
  globalIfChanged: readonly string[];
};

function checkNativeStepStructure(
  key: string,
  block: string,
  labels: readonly string[],
): void {
  if (labels.length > 0) {
    fail(`native step ${key} must not declare Kubernetes pod metadata`);
  }
  if (!/^ {4}agents:\n {6}queue: macos$/mu.test(block)) {
    fail(`native step ${key} must target queue macos`);
  }
  if (/^ {4}plugins:/mu.test(block) || block.includes("kubernetes:")) {
    fail(`native step ${key} must be a hard step without plugins`);
  }
  if (/^ {4}soft_fail:/mu.test(block)) {
    fail(`native step ${key} must be a hard step`);
  }
  if (!/^ {4}depends_on: verify$/mu.test(block)) {
    fail(`native step ${key} must wait for verify`);
  }
  if (
    !/^ {4}concurrency: 1$/mu.test(block) ||
    !/^ {4}concurrency_group: monorepo\/macos-native$/mu.test(block)
  ) {
    fail(`native step ${key} must serialize in monorepo/macos-native`);
  }
}

function checkKubernetesStepStructure(
  key: string,
  block: string,
  labels: readonly string[],
  config: Pick<
    StepStructureConfig,
    "sharedPodAnchors" | "checkoutContainerAlias"
  >,
): void {
  if (labels.length !== 1 || labels[0] !== key) {
    fail(
      `step ${key} must have exactly one ci.sjer.red/step-key label equal to its key`,
    );
  }

  const inheritedCheckoutPatch = config.sharedPodAnchors.some((anchorName) =>
    block.includes(`<<: *${anchorName}`),
  );
  const directCheckoutPatch = hasTrimmedLine(
    block,
    config.checkoutContainerAlias,
  );
  if (!inheritedCheckoutPatch && !directCheckoutPatch) {
    fail(`step ${key} does not patch checkout to 1Gi/2Gi`);
  }
}

function checkPathGatedIfChanged(
  key: string,
  block: string,
  globalIfChanged: readonly string[],
): void {
  if (!/^ {4}if_changed:/m.test(block)) {
    fail(`PR lane ${key} has no native if_changed gate`);
  }
  for (const globalPath of globalIfChanged) {
    if (!block.includes(`- ${globalPath}`)) {
      fail(`PR lane ${key} is missing global if_changed path ${globalPath}`);
    }
  }
}

export function checkStepStructure(
  key: string,
  block: string,
  blockLines: string[],
  config: StepStructureConfig,
): void {
  const {
    sharedPodAnchors,
    checkoutContainerAlias,
    pathGatedPrKeys,
    nativeStepKeys,
  } = config;

  if (!blockLines.some((line) => line.startsWith("    if:"))) {
    fail(`step ${key} has no condition`);
  }

  const labels = blockLines
    .filter((line) => /^\s+ci\.sjer\.red\/step-key:/.test(line))
    .map((line) => scalar(line.replace(/^\s+ci\.sjer\.red\/step-key:\s*/, "")));

  if (nativeStepKeys.has(key)) {
    checkNativeStepStructure(key, block, labels);
  } else {
    checkKubernetesStepStructure(key, block, labels, {
      sharedPodAnchors,
      checkoutContainerAlias,
    });
  }

  if (pathGatedPrKeys.has(key)) {
    checkPathGatedIfChanged(key, block, config.globalIfChanged);
  }
}
