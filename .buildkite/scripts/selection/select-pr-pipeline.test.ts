import { describe, expect, test } from "vitest";
import { parsePipeline } from "../selectors/select-main-pipeline.ts";
import { changedStep, selectPrSteps } from "./select-pr-pipeline.ts";

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
`);
    const selected = selectPrSteps(document, ["packages/site/src/app.ts"]);
    expect(selected.map((step) => step["key"])).toEqual(["verify", "browser"]);
    expect(selected[1]?.["if_changed"]).toBeUndefined();
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
`);
    expect(
      selectPrSteps(document, [".buildkite/pipeline.yml"]).map(
        (step) => step["key"],
      ),
    ).toEqual(["verify", "browser", "other"]);
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
