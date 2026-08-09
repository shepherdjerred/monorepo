import { expect, test } from "bun:test";
import {
  mainSteps,
  parsePipeline,
  renderSteps,
  selectedKeys,
  validateRenderedSteps,
} from "./select-main-pipeline.ts";

const repoRoot = new URL("../..", import.meta.url).pathname;
const pipeline = await Bun.file(`${repoRoot}/.buildkite/pipeline.yml`).text();
const document = parsePipeline(pipeline);
const steps = mainSteps(document);

test("keeps only required main jobs when no optional lane changed", () => {
  const selected = selectedKeys(steps, new Map());
  expect([...selected]).toEqual(["verify", "release-please", "build-summary"]);
  const rendered = renderSteps(steps, selected);
  validateRenderedSteps(rendered);
  expect(rendered.map((step) => step["key"])).toEqual([
    "verify",
    "release-please",
    "build-summary",
  ]);
  expect(rendered[2]?.["depends_on"]).toEqual([
    "ci-selector-base",
    "verify",
    "release-please",
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

test("keeps infrastructure and publish lanes in the main graph", () => {
  const laneDecisions = new Map([
    ["tofu", true],
    ["npm", true],
    ["cooklang", true],
  ]);
  const selected = selectedKeys(steps, laneDecisions);
  expect(selected.has("tofu-apply")).toBe(true);
  expect(selected.has("tofu-github")).toBe(true);
  expect(selected.has("publish")).toBe(true);
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

test("validates the complete-graph fallback", () => {
  const rendered = renderSteps(steps, new Set(steps.keys()));
  expect(() => validateRenderedSteps(rendered)).not.toThrow();
  expect(rendered.length).toBe(steps.size);
});
