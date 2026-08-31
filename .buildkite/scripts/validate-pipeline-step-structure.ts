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

/**
 * Native steps are hard gates by default, and that is the point of the check
 * below: a macOS lane that can quietly stop blocking is a lane nobody notices
 * has stopped working.
 *
 * This set is the deliberate exception to that. Keeping it here rather than
 * allowing `soft_fail` on any native step means an exemption has to be argued
 * for in a diff, and it stays visible afterwards. Each entry needs a reason
 * and the condition that removes it again.
 *
 * tasknotes-native-main: the macOS agent cannot start a UI test runner --
 *   "Failed to initialize for UI testing: Timed out while enabling automation
 *   mode." That is a TCC grant on that machine, so no commit can satisfy it.
 *   Remove this entry once TaskNotesUITests-Runner is approved under System
 *   Settings > Privacy & Security > Accessibility on the agent, signed with
 *   the Apple Development identity so the grant survives rebuilds (see
 *   packages/tasknotes-macos/CLAUDE.md).
 */
const SOFT_FAIL_EXEMPT_NATIVE_STEPS: ReadonlySet<string> = new Set([
  "tasknotes-native-main",
]);

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
  const declaresSoftFail = /^ {4}soft_fail:/mu.test(block);
  const exempt = SOFT_FAIL_EXEMPT_NATIVE_STEPS.has(key);
  if (declaresSoftFail && !exempt) {
    fail(
      `native step ${key} must be a hard step; add it to SOFT_FAIL_EXEMPT_NATIVE_STEPS with a reason if it genuinely cannot gate`,
    );
  }
  // The exemption expires with the condition that justified it: once the step
  // gates again, the entry has to go, or the next one inherits a silent pass.
  if (!declaresSoftFail && exempt) {
    fail(
      `native step ${key} is listed in SOFT_FAIL_EXEMPT_NATIVE_STEPS but no longer declares soft_fail; drop the exemption`,
    );
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
