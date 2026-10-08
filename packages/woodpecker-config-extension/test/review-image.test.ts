import { expect, test } from "vitest";
import { prGateSteps } from "#src/pipeline/lanes/pr-gates.ts";
import { completionStep } from "#src/pipeline/completion.ts";
import { TEST_IMAGES } from "./identity.ts";

test("trusted policy image removes checkout, install, and persistent review auth", () => {
  const image = `ghcr.io/shepherdjerred/woodpecker-config-extension@sha256:${"c".repeat(64)}`;
  const review = prGateSteps(TEST_IMAGES, image).find(
    (step) => step.key === "codex-review-gate",
  );
  expect(review?.image).toBe(image);
  expect(review?.skipClone).toBe(true);
  expect(review?.commands).toEqual(["cd /app", "bun /app/review-gate.js"]);
  expect(review?.volumes).toEqual([]);
  expect(review?.environment?.["REVIEW_PROVIDERS"]).toBe("codex,coderabbit");
  if (review === undefined) throw new Error("missing review");
  const complete = completionStep([review], image, "/app");
  expect(complete.image).toBe(image);
  expect(complete.commands[0]).toBe("cd /app");
  expect(complete.skipClone).toBe(true);
});
