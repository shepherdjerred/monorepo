import { describe, expect, test } from "vitest";
import { parsePipeline } from "../selectors/select-main-pipeline.ts";
import {
  changedStep,
  REVIEW_GATE_KEY,
  selectPrSteps,
} from "./select-pr-pipeline.ts";

const PIPELINE_PATH = new URL("../../pipeline.yml", import.meta.url).pathname;

function gate(dependencies: readonly string[]): string {
  return `  - key: ${REVIEW_GATE_KEY}
    if: build.pull_request.id != null
    depends_on: [${dependencies.join(", ")}]
    allow_dependency_failure: true
`;
}

describe("PR pipeline selection", () => {
  test("keeps matching PR jobs and their dependency closure", () => {
    const document = parsePipeline(`steps:
  - key: verify
  - key: browser
    if: build.pull_request.id != null
    if_changed:
      include: [packages/site/**]
    depends_on: verify
  - key: unrelated
    if: build.pull_request.id != null
    if_changed:
      include: [packages/other/**]
  - key: deploy
    if: build.branch == pipeline.default_branch
${gate(["verify", "browser", "unrelated"])}`);
    const selected = selectPrSteps(document, ["packages/site/src/app.ts"]);
    expect(selected.map((step) => step["key"])).toEqual([
      "verify",
      "browser",
      REVIEW_GATE_KEY,
    ]);
    expect(selected[1]?.["if_changed"]).toBeUndefined();
    // Ordering edges keep only selected lanes; they never schedule `unrelated`.
    expect(selected[2]?.["depends_on"]).toEqual(["verify", "browser"]);
  });

  test("pipeline and selector changes fail open to every PR step", () => {
    const document = parsePipeline(`steps:
  - key: verify
  - key: browser
    if_changed: packages/site/**
  - key: other
    if_changed: packages/other/**
  - key: main
    if: build.branch == pipeline.default_branch
${gate(["verify", "browser", "other"])}`);
    for (const changedPath of [
      ".buildkite/pipeline.yml",
      ".buildkite/scripts/selectors/select-main-pipeline.ts",
      "scripts/ci-test-manifest.json",
      "scripts/lib/json.ts",
    ]) {
      expect(
        selectPrSteps(document, [changedPath]).map((step) => step["key"]),
      ).toEqual(["verify", "browser", "other", REVIEW_GATE_KEY]);
    }
  });

  test("honors include and exclude globs", () => {
    const step = {
      key: "scanner",
      if_changed: { include: ["**/*.ts"], exclude: "sandbox/**" },
    };
    expect(changedStep(step, ["packages/app/src.ts"])).toBe(true);
    expect(changedStep(step, ["sandbox/example.ts"])).toBe(false);
  });
});

describe("Codex review gate cannot cancel the rest of PR CI", () => {
  test("rejects a PR step the gate could run beside", () => {
    const document = parsePipeline(`steps:
  - key: verify
    cancel_on_build_failing: true
  - key: browser
    cancel_on_build_failing: true
${gate(["verify"])}`);
    expect(() => selectPrSteps(document, ["README.md"])).toThrow(
      "missing: browser",
    );
  });

  test("rejects a gate that stops reporting after another step fails", () => {
    const document = parsePipeline(`steps:
  - key: verify
  - key: ${REVIEW_GATE_KEY}
    depends_on: verify
`);
    expect(() => selectPrSteps(document, ["README.md"])).toThrow(
      "allow_dependency_failure",
    );
  });

  test("rejects a softened or self-canceling gate", () => {
    for (const field of ["soft_fail: true", "cancel_on_build_failing: true"]) {
      const document = parsePipeline(`steps:
  - key: verify
${gate(["verify"])}    ${field}
`);
      expect(() => selectPrSteps(document, ["README.md"])).toThrow(
        `must not set ${field.split(":")[0] ?? ""}`,
      );
    }
  });

  test("the real pipeline runs the gate after every other PR step", async () => {
    const document = parsePipeline(await Bun.file(PIPELINE_PATH).text());
    const selected = selectPrSteps(document, [".buildkite/pipeline.yml"]);
    const gateStep = selected.find((step) => step["key"] === REVIEW_GATE_KEY);
    const others = selected
      .map((step) => step["key"])
      .filter((key) => key !== REVIEW_GATE_KEY);
    expect(gateStep?.["depends_on"]).toEqual(others);
    expect(gateStep?.["allow_dependency_failure"]).toBe(true);
    expect(gateStep?.["soft_fail"]).toBeUndefined();
    expect(gateStep?.["cancel_on_build_failing"]).toBeUndefined();
    // verify still cancels its siblings when it fails.
    const verify = selected.find((step) => step["key"] === "verify");
    expect(verify?.["cancel_on_build_failing"]).toBe(true);
  });

  test("a narrow PR keeps the gate without scheduling unrelated lanes", async () => {
    const document = parsePipeline(await Bun.file(PIPELINE_PATH).text());
    const selected = selectPrSteps(document, ["README.md"]);
    const keys = selected.map((step) => step["key"]);
    expect(keys).toContain(REVIEW_GATE_KEY);
    expect(keys).not.toContain("tofu-plan-cloudflare");
    const gateStep = selected.find((step) => step["key"] === REVIEW_GATE_KEY);
    expect(gateStep?.["depends_on"]).toEqual(
      keys.filter((key) => key !== REVIEW_GATE_KEY),
    );
  });
});
