import { expect, test } from "vitest";
import { parse } from "yaml";
import { prGateSteps } from "#src/pipeline/lanes/pr-gates.ts";
import { completionStep } from "#src/pipeline/completion.ts";
import { emitWorkflow } from "#src/pipeline/emit.ts";
import { TEST_IDENTITY, TEST_IMAGES } from "./identity.ts";

test("trusted policy image removes checkout, install, and persistent review auth", () => {
  const image = `ghcr.io/shepherdjerred/woodpecker-config-extension@sha256:${"c".repeat(64)}`;
  const review = prGateSteps(TEST_IMAGES, image).find(
    (step) => step.key === "codex-review-gate",
  );
  expect(review?.image).toBe(image);
  expect(review?.skipClone).toBe(true);
  expect(review?.commands).toEqual(["bun /app/review-gate.js"]);
  expect(review?.volumes).toEqual([]);
  expect(review?.environment?.["REVIEW_PROVIDERS"]).toBe("codex,coderabbit");
  if (review === undefined) throw new Error("missing review");
  const complete = completionStep([review], image, "/app");
  expect(complete.image).toBe(image);
  expect(complete.skipClone).toBe(true);
  for (const step of [review, complete]) {
    expect(step.workingDirectory).toBe("/app");
    const emitted: unknown = parse(emitWorkflow(step, TEST_IDENTITY));
    expect(emitted).toMatchObject({
      skip_clone: true,
      steps: [{ name: step.key, directory: "/app" }],
    });
  }
});

test("legacy review keeps its checkout and default working directory", () => {
  const review = prGateSteps(TEST_IMAGES).find(
    (step) => step.key === "codex-review-gate",
  );
  if (review === undefined) throw new Error("missing review");
  expect(review.skipClone).toBeUndefined();
  expect(review.workingDirectory).toBeUndefined();
  const complete = completionStep([review], TEST_IMAGES.base);
  const emitted: unknown = parse(emitWorkflow(complete, TEST_IDENTITY));
  expect(emitted).toMatchObject({
    skip_clone: true,
    steps: [{ name: "ci-complete", directory: "/workspace" }],
  });
});
