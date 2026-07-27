// Generic parsing and structural-check helpers for validate-pipeline.ts, split
// out to keep the entry file under the max-lines budget. Content-specific
// invariant checks stay in validate-pipeline.ts; this file only holds the
// mechanical text parsing and per-step structural checks it drives.

export const SHARED_POD_ANCHORS = [
  "pod_kubernetes",
  "pod_buildkit_kubernetes",
  "pod_verify_kubernetes",
  "pod_light_kubernetes",
  "pod_tofu_kubernetes",
] as const;
export const CHECKOUT_CONTAINER_ALIAS = "- *checkout_container";

export function fail(message: string): never {
  throw new Error(`[validate-pipeline] ${message}`);
}

export function scalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function hasTrimmedLine(
  block: string | undefined,
  expected: string,
): boolean {
  return block?.split("\n").some((line) => line.trim() === expected) ?? false;
}

// Assert exactly one bare `bun install --frozen-lockfile` exists and that it
// belongs to the verify step's block, so no other lane can restore a full root
// install.
export function assertUnfilteredInstallBelongsToVerify(
  lines: string[],
  stepStarts: number[],
): void {
  const unfilteredInstalls = lines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter((entry) => entry.line === "bun install --frozen-lockfile");
  if (unfilteredInstalls.length !== 1) {
    fail(
      `expected one unfiltered root install, found ${unfilteredInstalls.length.toString()}`,
    );
  }
  const verifyStart = stepStarts.find((start) =>
    lines.slice(start, start + 4).includes("    key: verify"),
  );
  const unfilteredInstall = unfilteredInstalls[0];
  if (verifyStart === undefined || unfilteredInstall === undefined) {
    fail("verify or its unfiltered install disappeared");
  }
  const verifyEnd =
    stepStarts.find((start) => start > verifyStart) ?? lines.length;
  if (
    unfilteredInstall.index < verifyStart ||
    unfilteredInstall.index >= verifyEnd
  ) {
    fail("the only unfiltered root install must belong to verify");
  }
}

// Assert every token is present in the haystack, failing with a per-token
// message otherwise. Collapses the repeated `for … if (!includes) fail` shape.
export function requireAllPresent(
  haystack: string,
  tokens: readonly string[],
  message: (token: string) => string,
): void {
  for (const token of tokens) {
    if (!haystack.includes(token)) {
      fail(message(token));
    }
  }
}

// Assert none of the tokens appear in the haystack (rejected/forbidden paths).
export function requireNonePresent(
  haystack: string,
  tokens: readonly string[],
  message: (token: string) => string,
): void {
  for (const token of tokens) {
    if (haystack.includes(token)) {
      fail(message(token));
    }
  }
}

// Guard every dependency-minimized runtime source against a `bun`/`bunx`
// invocation that could silently trigger a full auto-install. Reports the
// filtered (comment-stripped) line number so the offending command is findable.
export function assertNoImplicitBunRuntime(
  sources: readonly { path: string; source: string }[],
): void {
  const implicitBunInstall =
    /\bbun\s+(?!install(?:\s|$)|--no-install(?:\s|$))/g;
  const implicitBunxInstall = /\bbunx\s+(?!--no-install(?:\s|$))/g;
  for (const { path, source } of sources) {
    const commands = source
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");
    const implicitMatch = implicitBunInstall.exec(commands);
    implicitBunInstall.lastIndex = 0;
    if (implicitMatch !== null) {
      const line = commands.slice(0, implicitMatch.index).split("\n").length;
      fail(
        `Bun runtime in ${path} at filtered line ${line.toString()} can auto-install dependencies`,
      );
    }
    const implicitBunxMatch = implicitBunxInstall.exec(commands);
    implicitBunxInstall.lastIndex = 0;
    if (implicitBunxMatch !== null) {
      const line = commands
        .slice(0, implicitBunxMatch.index)
        .split("\n").length;
      fail(
        `bunx runtime in ${path} at filtered line ${line.toString()} can auto-install dependencies`,
      );
    }
  }
}

// The shell-level scan cannot see Bun processes launched by the automation
// scripts themselves. Check every child-Bun launcher reachable from a
// dependency-minimized pipeline lane and allow only explicit no-install
// runtimes or Bun subcommands that do not execute repository code.
export async function assertNoNestedBunRuntime(
  paths: readonly string[],
): Promise<void> {
  const implicitChildBun =
    /\[\s*"bun",(?!\s*"(?:--no-install|install|x|publish)")/;
  const implicitChildBunx = /\[\s*"bun",\s*"x",(?!\s*"--no-install")/;
  const implicitShellBunx = /\bbun x\s+(?!--no-install(?:\s|$))/;
  const implicitBuildCommand =
    /buildCmd:\s*["'`]bun\s+(?!--no-install(?:\s|$))/;
  const implicitTaggedBun =
    /(?:Bun\.)?\$`bun\s+(?!--no-install(?:\s|$)|install(?:\s|$)|x(?:\s|$)|publish(?:\s|$))/;
  for (const path of paths) {
    const source = await Bun.file(path).text();
    if (
      implicitChildBun.test(source) ||
      implicitChildBunx.test(source) ||
      implicitShellBunx.test(source) ||
      implicitBuildCommand.test(source) ||
      implicitTaggedBun.test(source)
    ) {
      fail(`nested Bun runtime in ${path} can auto-install dependencies`);
    }
  }
}

// Assert each CI package manifest still declares its explicit tool
// dependencies, so a dependency-minimized lane cannot fall back to auto-install.
export async function assertPackageTokens(
  specs: readonly (readonly [string, readonly string[]])[],
): Promise<void> {
  for (const [path, required] of specs) {
    const manifest = await Bun.file(path).text();
    for (const token of required) {
      if (!manifest.includes(token)) {
        fail(`CI package ${path} is missing explicit tool dependency ${token}`);
      }
    }
  }
}

// Assert that a (possibly missing) step/lane block contains a required token,
// failing with the caller's message otherwise. The undefined check is a
// separate statement so a missing block and a missing token report the same
// message without collapsing into a nullable-boolean conditional.
export function requireIncludes(
  block: string | undefined,
  token: string,
  message: string,
): void {
  if (block === undefined) {
    fail(message);
  }
  if (!block.includes(token)) {
    fail(message);
  }
}

export function sharedPodAnchorBlock(
  pipeline: string,
  anchorName: string,
): string {
  const marker = `      kubernetes: &${anchorName}\n`;
  const start = pipeline.indexOf(marker);
  if (start === -1) {
    fail(`pipeline is missing shared pod anchor ${anchorName}`);
  }
  const end = pipeline.indexOf("\n  - ", start);
  if (end === -1) {
    fail(`shared pod anchor ${anchorName} has no boundary`);
  }
  return pipeline.slice(start, end);
}

// Top-level `name=( … )` array definitions in the selector. Lane case arms
// reference them as "${name[@]}" (the per-site lists are defined once and the
// aggregate `sites` lane is their union), so lane blocks must be expanded
// through this map before asserting on literal paths.
function selectorArrays(ciChanged: string): Map<string, string> {
  const arrays = new Map<string, string>();
  for (const match of ciChanged.matchAll(/^([a-z0-9_]+)=\(([\s\S]*?)\)/gm)) {
    const [, name, contents] = match;
    if (name !== undefined && contents !== undefined) {
      arrays.set(name, contents);
    }
  }
  return arrays;
}

export function selectorLane(ciChanged: string, lane: string): string {
  const startMarker = `  ${lane})\n`;
  const start = ciChanged.indexOf(startMarker);
  if (start === -1) {
    fail(`runtime CI selector is missing lane ${lane}`);
  }
  const blockStart = start + startMarker.length;
  const blockEnd = ciChanged.indexOf("\n    ;;", blockStart);
  if (blockEnd === -1) {
    fail(`runtime CI selector lane ${lane} has no terminator`);
  }
  const arrays = selectorArrays(ciChanged);
  return ciChanged
    .slice(blockStart, blockEnd)
    .replaceAll(/"\$\{([a-z0-9_]+)\[@\]\}"/g, (_reference, name: string) => {
      const contents = arrays.get(name);
      if (contents === undefined) {
        fail(
          `runtime CI selector lane ${lane} references undefined array ${name}`,
        );
      }
      return contents;
    });
}

export function containerBlock(
  stepKey: string,
  step: string | undefined,
  containerName: string,
): string {
  if (step === undefined) {
    fail(`pipeline is missing step ${stepKey}`);
  }
  const marker = `              - name: ${containerName}\n`;
  const start = step.indexOf(marker);
  if (start === -1) {
    fail(`step ${stepKey} is missing container ${containerName}`);
  }
  const blockStart = start + marker.length;
  const nextContainer = step.indexOf("\n              - name:", blockStart);
  return step.slice(
    blockStart,
    nextContainer === -1 ? step.length : nextContainer,
  );
}

export type StepStructureConfig = {
  sharedPodAnchors: readonly string[];
  checkoutContainerAlias: string;
  pathGatedPrKeys: ReadonlySet<string>;
  globalIfChanged: readonly string[];
};

function checkStepStructure(
  key: string,
  block: string,
  blockLines: string[],
  config: StepStructureConfig,
): void {
  const { sharedPodAnchors, checkoutContainerAlias, pathGatedPrKeys } = config;

  if (!blockLines.some((line) => line.startsWith("    if:"))) {
    fail(`step ${key} has no condition`);
  }

  const labels = blockLines
    .filter((line) => /^\s+ci\.sjer\.red\/step-key:/.test(line))
    .map((line) => scalar(line.replace(/^\s+ci\.sjer\.red\/step-key:\s*/, "")));
  if (labels.length !== 1 || labels[0] !== key) {
    fail(
      `step ${key} must have exactly one ci.sjer.red/step-key label equal to its key`,
    );
  }

  const inheritedCheckoutPatch = sharedPodAnchors.some((anchorName) =>
    block.includes(`<<: *${anchorName}`),
  );
  const directCheckoutPatch = hasTrimmedLine(block, checkoutContainerAlias);
  if (!inheritedCheckoutPatch && !directCheckoutPatch) {
    fail(`step ${key} does not patch checkout to 1Gi/2Gi`);
  }

  if (pathGatedPrKeys.has(key)) {
    if (!/^ {4}if_changed:/m.test(block)) {
      fail(`PR lane ${key} has no native if_changed gate`);
    }
    for (const globalPath of config.globalIfChanged) {
      if (!block.includes(`- ${globalPath}`)) {
        fail(`PR lane ${key} is missing global if_changed path ${globalPath}`);
      }
    }
  }
}

export type StepIndex = {
  stepStarts: number[];
  keys: Set<string>;
  stepBlocks: Map<string, string>;
};

export function collectStepBlocks(
  lines: string[],
  config: StepStructureConfig,
): StepIndex {
  const stepStarts = lines
    .map((line, index) => (line.startsWith("  - label:") ? index : -1))
    .filter((index) => index !== -1);
  const keys = new Set<string>();
  const stepBlocks = new Map<string, string>();

  for (const [position, start] of stepStarts.entries()) {
    const end = stepStarts[position + 1] ?? lines.length;
    const blockLines = lines.slice(start, end);
    const block = blockLines.join("\n");
    if (!/^ {4}command:/m.test(block)) {
      continue;
    }

    const keyLine = blockLines.find((line) => line.startsWith("    key:"));
    if (keyLine === undefined) {
      fail(`command step at line ${(start + 1).toString()} has no key`);
    }
    const key = scalar(keyLine.replace(/^ {4}key:\s*/, ""));
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(key)) {
      fail(`step key ${key} is not a stable lowercase identifier`);
    }
    if (keys.has(key)) {
      fail(`duplicate step key ${key}`);
    }
    keys.add(key);
    stepBlocks.set(key, block);

    checkStepStructure(key, block, blockLines, config);
  }

  return { stepStarts, keys, stepBlocks };
}
