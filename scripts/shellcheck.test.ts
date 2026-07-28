import { expect, test } from "bun:test";

import { isShellcheckCandidate } from "./migration-core.ts";

test("isShellcheckCandidate excludes vendored and generated shell surfaces", () => {
  expect(isShellcheckCandidate("packages/a/run.sh")).toBe(true);
  expect(isShellcheckCandidate("packages/a/wasm-src/build.sh")).toBe(false);
  expect(isShellcheckCandidate("sandbox/archive/run.sh")).toBe(false);
  expect(isShellcheckCandidate("ios/Pods/tool.sh")).toBe(false);
  expect(isShellcheckCandidate("crate/target/tool.sh")).toBe(false);
});
