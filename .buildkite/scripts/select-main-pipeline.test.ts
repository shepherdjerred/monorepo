import { expect, test } from "vitest";
import {
  assertSelectionContract,
  annotateFallback,
  mainSteps,
  parsePipeline,
  pipelinePayload,
  prepareBase,
  recordSelectedSteps,
  renderFallbackSteps,
  renderSteps,
  runSelection,
  selectLanes,
  selectedKeys,
  validateRenderedSteps,
  uploadPipeline,
  writeSelectorChangedFiles,
} from "./select-main-pipeline.ts";
import {
  pipelineUploadArguments,
  runCommand,
} from "./select-main-pipeline-io.ts";

const repoRoot = new URL("../..", import.meta.url).pathname;
const pipeline = await Bun.file(`${repoRoot}/.buildkite/pipeline.yml`).text();
const document = parsePipeline(pipeline);
const steps = mainSteps(document);
const bootstrapDocument = parsePipeline(
  await Bun.file(`${repoRoot}/.buildkite/main-bootstrap.yml`).text(),
);

test("models every discovered main step in the selection contract", () => {
  expect(() => assertSelectionContract(steps)).not.toThrow();
});

test("rejects an unmodeled main step", () => {
  const unmodeled = new Map([
    ["verify", { key: "verify" }],
    ["unmodeled", { key: "unmodeled" }],
  ]);
  expect(() => assertSelectionContract(unmodeled)).toThrow(
    "main step unmodeled has no dynamic-selection contract",
  );
});

test("runs selector subprocesses with explicit environment and exit status", async () => {
  const exitCode = await runCommand(
    [
      "bun",
      "-e",
      'console.log(Bun.env.SELECTOR_TEST_VALUE); console.error("selector-test-stderr"); process.exit(78)',
    ],
    { SELECTOR_TEST_VALUE: "selector-test-stdout" },
  );
  expect(exitCode).toBe(78);
});

test("keeps only required main jobs when no optional lane changed", () => {
  const selected = selectedKeys(steps, new Map());
  expect([...selected]).toEqual([
    "verify",
    "alert-dashboard-sqlite",
    "release-please",
    "build-summary",
    "homelab-release-admission",
  ]);
  const rendered = renderSteps(steps, selected);
  validateRenderedSteps(rendered);
  expect(rendered.map((step) => step["key"])).toEqual([
    "verify",
    "alert-dashboard-sqlite",
    "homelab-release-admission",
    "release-please",
    "build-summary",
  ]);
  expect(rendered[1]?.["if_changed"]).toBeUndefined();
  expect(rendered[4]?.["depends_on"]).toEqual([
    "ci-selector-base",
    "verify",
    "homelab-release-admission",
    "release-please",
  ]);
});

test("retains native path filters for selected optional main lanes", () => {
  const optionalDocument = parsePipeline(`steps:
  - key: verify
  - key: images
    if: build.branch == pipeline.default_branch
    if_changed: packages/homelab/**
`);
  const rendered = renderSteps(
    mainSteps(optionalDocument),
    new Set(["verify", "images"]),
  );
  expect(rendered[1]?.["if_changed"]).toBe("packages/homelab/**");
});

test("keeps fixed-corpus configuration failures hard", async () => {
  expect(bootstrapDocument.steps[0]?.["soft_fail"]).toBeUndefined();
  const child = Bun.spawn(
    ["bun", "--no-install", ".buildkite/scripts/select-main-pipeline.ts"],
    {
      cwd: repoRoot,
      env: {
        ...Bun.env,
        BUILDKITE_BRANCH: "feature/not-main",
        CI_IO_FIXED_CORPUS: "true",
      },
      stdout: "ignore",
      stderr: "pipe",
    },
  );
  const stderr = await new Response(child.stderr).text();
  expect(await child.exited).not.toBe(0);
  expect(stderr).toContain("CI_IO_FIXED_CORPUS is main-only");
});

test("resolves committed image pins before the dynamic pipeline upload", () => {
  const command = bootstrapDocument.steps[0]?.["command"];
  if (typeof command !== "string") {
    throw new TypeError("main selector bootstrap command must be a string");
  }
  expect(command).toContain(". .buildkite/scripts/ci-image-refs.sh");
  expect(command.indexOf("ci-image-refs.sh")).toBeLessThan(
    command.indexOf("select-main-pipeline.ts"),
  );

  const payload = pipelinePayload(document, document.steps, {
    CI_BASE_IMAGE: "registry.example/ci-base@sha256:base",
    CI_PLAYWRIGHT_IMAGE: "registry.example/ci-playwright@sha256:playwright",
  });
  expect(payload).not.toContain("${CI_BASE_IMAGE}");
  expect(payload).not.toContain("${CI_PLAYWRIGHT_IMAGE}");
  expect(payload).toContain("registry.example/ci-base@sha256:base");
  expect(payload).toContain("registry.example/ci-playwright@sha256:playwright");
  expect(() => pipelinePayload(document, document.steps, {})).toThrow(
    "CI_BASE_IMAGE must be a non-empty string",
  );
});

test("uploads the selected graph with the selector-base changed-file list", () => {
  // `--replace` is load-bearing, not incidental: it swaps the not-yet-started
  // remainder of the build rather than appending, so a retried
  // `ci-selector-base` re-uploads the same graph instead of scheduling every
  // step twice. Dropping it would make a selector retry duplicate the build.
  expect(pipelineUploadArguments("/tmp/selector-changes")).toEqual([
    "buildkite-agent",
    "pipeline",
    "upload",
    "--replace",
    "--changed-files-path",
    "/tmp/selector-changes",
  ]);
});

test("retains the full dependency chain for an image release", () => {
  const selected = selectedKeys(
    steps,
    new Map([
      ["images", true],
      ["helm", false],
      ["argocd", false],
      ["tofu", false],
      ["site-scout", false],
      ["scout-reconcile", false],
      ["ci-base", false],
      ["ci-playwright", false],
      ["npm", false],
      ["cooklang", false],
      ["sites", false],
      ["playwright", false],
      ["resume", false],
      ["docker-e2e", false],
    ]),
  );
  expect(selected.has("images")).toBe(true);
  expect(selected.has("helm-push")).toBe(true);
  expect(selected.has("argocd-sync")).toBe(true);
  expect(selected.has("version-commit-back")).toBe(true);
});

test("retains Cloudflare reconciliation for an ArgoCD release", () => {
  const selected = selectedKeys(steps, new Map([["argocd", true]]));

  expect(selected.has("argocd-sync")).toBe(true);
  expect(selected.has("tofu-apply-cloudflare")).toBe(true);
});

test("keeps browser, resume, and Docker E2E lanes independently selectable", () => {
  const laneDecisions = new Map([
    ["playwright", true],
    ["resume", true],
    ["docker-e2e", true],
  ]);
  const selected = selectedKeys(steps, laneDecisions);
  expect(selected.has("playwright-e2e-main")).toBe(true);
  expect(selected.has("resume-build-main")).toBe(true);
  expect(selected.has("docker-e2e-main")).toBe(true);
});

test("keeps QuotaBar and TaskNotes native lanes independently selectable", () => {
  const quotaOnly = selectedKeys(
    steps,
    new Map([
      ["quotabar-macos", true],
      ["tasknotes-native", false],
    ]),
  );
  expect(quotaOnly.has("quotabar-macos-main")).toBe(true);
  expect(quotaOnly.has("tasknotes-native-main")).toBe(false);
  expect(quotaOnly.has("verify")).toBe(true);

  const taskNotesOnly = selectedKeys(
    steps,
    new Map([
      ["quotabar-macos", false],
      ["tasknotes-native", true],
    ]),
  );
  expect(taskNotesOnly.has("quotabar-macos-main")).toBe(false);
  expect(taskNotesOnly.has("tasknotes-native-main")).toBe(true);
  expect(taskNotesOnly.has("verify")).toBe(true);
});

test("keeps infrastructure and publish lanes in the main graph", () => {
  const laneDecisions = new Map([
    ["tofu", true],
    ["npm", true],
    ["cooklang", true],
  ]);
  const selected = selectedKeys(steps, laneDecisions);
  expect(selected.has("tofu-apply-seaweedfs")).toBe(true);
  expect(selected.has("tofu-apply-tailscale")).toBe(true);
  expect(selected.has("tofu-apply-buildkite")).toBe(true);
  expect(selected.has("tofu-apply-arr")).toBe(true);
  expect(selected.has("tofu-apply-github")).toBe(true);
  expect(selected.has("publish")).toBe(true);
});

test("selects only the explicitly requested platform apply job", () => {
  const selected = selectedKeys(
    steps,
    new Map([["tofu-platforms", true]]),
    "tofu-platform-openrouter",
  );
  expect(selected.has("tofu-platform-openrouter")).toBe(true);
  expect(selected.has("tofu-platform-openai")).toBe(false);
  expect(selected.has("tofu-platform-anthropic")).toBe(false);
  expect(selected.has("tofu-platform-discord")).toBe(false);
  expect(selected.has("tofu-platform-cloudflare-tokens")).toBe(false);
  expect(selected.has("homelab-release-admission")).toBe(true);
});

test("preserves Scout beta, tag, and production ordering", () => {
  const laneDecisions = new Map([
    ["site-scout", true],
    ["scout-reconcile", true],
  ]);
  const selected = selectedKeys(steps, laneDecisions);
  const rendered = renderSteps(steps, selected);
  validateRenderedSteps(rendered);
  const renderedKeys = rendered.map((step) => step["key"]);
  expect(renderedKeys.indexOf("scout-beta-release")).toBeLessThan(
    renderedKeys.indexOf("scout-tag-release"),
  );
  expect(renderedKeys.indexOf("scout-beta-release")).toBeLessThan(
    renderedKeys.indexOf("scout-prod-reconcile"),
  );
  expect(renderedKeys.indexOf("scout-beta-release")).toBeGreaterThan(
    renderedKeys.indexOf("argocd-sync"),
  );
});

test("renders stable selector dependencies and no duplicate keys", () => {
  const selected = selectedKeys(steps, new Map());
  const rendered = renderSteps(steps, selected);
  validateRenderedSteps(rendered);
  const keys = rendered.map((step) => step["key"]);
  expect(new Set(keys).size).toBe(keys.length);
  for (const step of rendered) {
    expect(step["depends_on"]).toContain("ci-selector-base");
  }
});

test("rejects missing dependencies before dynamic upload", () => {
  const missingDependencySteps = new Map([
    ["verify", { key: "verify", depends_on: "missing-step" }],
    ["alert-dashboard-sqlite", { key: "alert-dashboard-sqlite" }],
    ["homelab-release-admission", { key: "homelab-release-admission" }],
    ["release-please", { key: "release-please" }],
    ["build-summary", { key: "build-summary" }],
  ]);
  expect(() => selectedKeys(missingDependencySteps, new Map())).toThrow(
    "verify depends on missing main step missing-step",
  );
});

test("rejects duplicate main step keys", () => {
  const duplicateDocument = parsePipeline(
    `steps:\n  - key: verify\n    if: build.branch == pipeline.default_branch\n  - key: verify\n    if: build.branch == pipeline.default_branch\n`,
  );
  expect(() => mainSteps(duplicateDocument)).toThrow(
    "duplicate main step key verify",
  );
});

test("recognizes a main condition however it is spaced", () => {
  // Buildkite ignores the spacing, so a reformatted condition still runs on
  // main. Missing it here would drop the step from the selection contract and
  // from every upload, silently retiring it.
  for (const condition of [
    "build.branch==pipeline.default_branch",
    "build.branch   ==   pipeline.default_branch",
    "build.pull_request.id == null && build.branch==pipeline.default_branch",
  ]) {
    const reformatted = parsePipeline(
      `steps:\n  - key: images\n    if: ${condition}\n`,
    );
    expect([...mainSteps(reformatted).keys()]).toEqual(["images"]);
  }
  const unrelated = parsePipeline(
    `steps:\n  - key: images\n    if: build.branch == "release-please"\n`,
  );
  expect([...mainSteps(unrelated).keys()]).toEqual([]);
});

test("rejects malformed pipeline and dependency shapes", () => {
  expect(() => parsePipeline("null")).toThrow("pipeline must be an object");
  expect(() => mainSteps(parsePipeline("steps:\n  - key: ''\n"))).toThrow(
    "pipeline step key must be a non-empty string",
  );
  expect(() =>
    renderSteps(
      new Map([["verify", { key: "verify", depends_on: 42 }]]),
      new Set(["verify"]),
    ),
  ).toThrow("verify has an unsupported depends_on shape");
});

test("rejects duplicate and dangling rendered steps", () => {
  expect(() =>
    validateRenderedSteps([{ key: "verify" }, { key: "verify" }]),
  ).toThrow("duplicate rendered main step key verify");
  expect(() =>
    validateRenderedSteps([{ key: "verify", depends_on: "missing" }]),
  ).toThrow("verify has missing rendered dependency missing");
});

test("validates the complete-graph fallback", () => {
  const rendered = renderSteps(steps, new Set(steps.keys()));
  expect(() => validateRenderedSteps(rendered)).not.toThrow();
  expect(rendered.length).toBe(steps.size);
});

test("keeps unmodeled main steps in the fail-open graph", () => {
  const fallbackDocument = parsePipeline(`steps:
  - key: verify
  - key: unmodeled
    if: build.branch == pipeline.default_branch
    if_changed: packages/example/**
`);
  const fallbackMainSteps = mainSteps(fallbackDocument);
  expect(() => assertSelectionContract(fallbackMainSteps)).toThrow(
    "main step unmodeled has no dynamic-selection contract",
  );
  const rendered = renderFallbackSteps(
    fallbackDocument,
    fallbackMainSteps,
    undefined,
  );
  expect(rendered.map((step) => step["key"])).toEqual(["verify", "unmodeled"]);
  expect(rendered[1]?.["if_changed"]).toBeUndefined();
});

test("removes native path filters from mandatory main gates", () => {
  const fallbackDocument = parsePipeline(`steps:
  - key: verify
  - key: alert-dashboard-sqlite
    if_changed: packages/alert-dashboard/**
`);
  const rendered = renderFallbackSteps(
    fallbackDocument,
    mainSteps(fallbackDocument),
    "/tmp/selector-changes",
  );
  expect(rendered[1]?.["if_changed"]).toBeUndefined();
});

test("prepares the selector base from successful metadata", async () => {
  const commands: string[][] = [];
  const base = await prepareBase(
    async (command) => {
      commands.push([...command]);
      return 0;
    },
    async () => ({ text: "  abc123  ", exitCode: 0 }),
  );
  expect(base).toBe("abc123");
  expect(commands).toHaveLength(1);
  await expect(
    prepareBase(
      async () => 1,
      async () => ({ text: "abc123", exitCode: 0 }),
    ),
  ).rejects.toThrow("main CI base selection failed");
  await expect(
    prepareBase(
      async () => 0,
      async () => ({ text: "", exitCode: 0 }),
    ),
  ).rejects.toThrow("main CI base metadata is unavailable");
  await expect(
    prepareBase(
      async () => 0,
      async () => ({ text: "abc123", exitCode: 1 }),
    ),
  ).rejects.toThrow("main CI base metadata is unavailable");
});

test("writes selector changed files and fails on a diff error", async () => {
  const path = await writeSelectorChangedFiles("base-sha", async (base) => {
    expect(base).toBe("base-sha");
    return { text: "packages/example/file.ts\n", exitCode: 0 };
  });
  expect(await Bun.file(path).text()).toBe("packages/example/file.ts\n");
  await Bun.file(path).delete();
  await expect(
    writeSelectorChangedFiles("base-sha", async () => ({
      text: "",
      exitCode: 1,
    })),
  ).rejects.toThrow("selector changed-file diff exited 1");
  const livePath = await writeSelectorChangedFiles("HEAD");
  expect(await Bun.file(livePath).exists()).toBe(true);
  await Bun.file(livePath).delete();
});

test("selects changed lanes and fails on an unexpected selector exit", async () => {
  const decisions = await selectLanes("base-sha", async (command) => {
    return command.at(-1) === "images" ? 0 : 78;
  });
  expect(decisions.get("images")).toBe(true);
  expect(decisions.get("playwright")).toBe(false);
  await expect(
    selectLanes("base-sha", async (command) =>
      command.at(-1) === "images" ? 1 : 78,
    ),
  ).rejects.toThrow("CI selector failed for lane images");
});

test("uploads and records selector metadata through their command seams", async () => {
  const uploadCalls: { command: readonly string[]; payload: string }[] = [];
  const uploadDocument = parsePipeline("steps:\n  - key: verify\n");
  await uploadPipeline(
    uploadDocument,
    uploadDocument.steps,
    undefined,
    async (command, payload) => {
      uploadCalls.push({ command, payload });
      return 0;
    },
  );
  expect(uploadCalls[0]?.command).toEqual([
    "buildkite-agent",
    "pipeline",
    "upload",
    "--replace",
  ]);
  expect(uploadCalls[0]?.payload).toContain('"steps"');
  await expect(
    uploadPipeline(
      uploadDocument,
      uploadDocument.steps,
      undefined,
      async () => 1,
    ),
  ).rejects.toThrow("pipeline upload failed with 1");

  const temporaryDirectory = `/tmp/select-main-pipeline-${crypto.randomUUID()}`;
  expect(await Bun.spawn(["mkdir", "-p", temporaryDirectory]).exited).toBe(0);
  const fakeAgent = `${temporaryDirectory}/buildkite-agent`;
  await Bun.write(fakeAgent, "#!/bin/sh\ncat >/dev/null\n");
  expect(await Bun.spawn(["chmod", "+x", fakeAgent]).exited).toBe(0);
  const previousPath = Bun.env["PATH"];
  Bun.env["PATH"] = `${temporaryDirectory}:${previousPath ?? ""}`;
  try {
    await uploadPipeline(uploadDocument, uploadDocument.steps, undefined);
    await recordSelectedSteps(new Set(["verify"]));
    await annotateFallback("test fallback");
    await expect(prepareBase(async () => 0)).rejects.toThrow(
      "main CI base metadata is unavailable",
    );
  } finally {
    if (previousPath === undefined) delete Bun.env["PATH"];
    else Bun.env["PATH"] = previousPath;
    await Bun.file(fakeAgent).delete();
    expect(await Bun.spawn(["rmdir", temporaryDirectory]).exited).toBe(0);
  }

  const metadata: string[][] = [];
  await recordSelectedSteps(
    new Set(["verify", "release-please"]),
    async (command) => {
      metadata.push([...command]);
      return 0;
    },
  );
  expect(metadata[0]?.slice(0, 4)).toEqual([
    "buildkite-agent",
    "meta-data",
    "set",
    "ci-selected-main-steps",
  ]);
  await expect(recordSelectedSteps(new Set(), async () => 1)).rejects.toThrow(
    "could not record selected main steps (exit 1)",
  );
});

test("annotates selector fallback and tolerates annotation failure", async () => {
  const commands: readonly string[][] = [];
  const captured = [...commands];
  await annotateFallback("selector failed", async (command) => {
    captured.push([...command]);
    return 0;
  });
  expect(captured[0]?.at(-1)).toBe(
    "Main CI selection failed open; uploaded the complete graph. selector failed",
  );
  await annotateFallback("annotation unavailable", async () => 1);
});

test("runs the selected graph and cleans up its changed-file list", async () => {
  const selectionDocument = parsePipeline(`steps:
  - key: verify
  - key: alert-dashboard-sqlite
  - key: homelab-release-admission
  - key: release-please
  - key: build-summary
    depends_on:
      - verify
      - alert-dashboard-sqlite
      - homelab-release-admission
      - release-please
`);
  const calls: string[] = [];
  const result = await runSelection(selectionDocument, {
    prepareBase: async () => "base-sha",
    writeChangedFiles: async () => "/tmp/selector-changes",
    selectLanes: async () => new Map(),
    recordSelectedSteps: async (selected) => {
      calls.push(`record:${String(selected.size)}`);
    },
    uploadPipeline: async (_document, renderedSteps, changedFilesPath) => {
      calls.push(
        `upload:${String(renderedSteps.length)}:${changedFilesPath ?? "none"}`,
      );
    },
    annotateFallback: async () => {
      calls.push("annotate");
    },
    deleteChangedFiles: async (path) => {
      calls.push(`delete:${path}`);
    },
  });
  expect(result).toBe(0);
  expect(calls).toEqual([
    "record:5",
    "upload:5:/tmp/selector-changes",
    "delete:/tmp/selector-changes",
  ]);
});

test("falls back to the complete graph when selection fails", async () => {
  const fallbackDocument = parsePipeline(`steps:
  - key: verify
  - key: alert-dashboard-sqlite
  - key: homelab-release-admission
  - key: release-please
  - key: build-summary
`);
  const calls: string[] = [];
  const result = await runSelection(fallbackDocument, {
    prepareBase: async () => {
      throw new Error("selector unavailable");
    },
    writeChangedFiles: async () => "/tmp/unreachable",
    selectLanes: async () => new Map(),
    recordSelectedSteps: async (selected) => {
      calls.push(`record:${String(selected.size)}`);
      throw new Error("metadata unavailable");
    },
    uploadPipeline: async (_document, renderedSteps, changedFilesPath) => {
      calls.push(
        `upload:${String(renderedSteps.length)}:${changedFilesPath ?? "none"}`,
      );
    },
    annotateFallback: async (reason) => {
      calls.push(`annotate:${reason}`);
    },
    deleteChangedFiles: async () => {
      calls.push("delete");
    },
  });
  expect(result).toBe(0);
  expect(calls).toEqual([
    "record:0",
    "upload:5:none",
    "annotate:selector unavailable",
  ]);
});
