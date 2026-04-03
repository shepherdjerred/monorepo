import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  BUN_IMAGE,
  RUST_IMAGE,
  GO_IMAGE,
  PLAYWRIGHT_IMAGE,
  SWIFTLINT_IMAGE,
  ALPINE_IMAGE,
  TOFU_IMAGE,
  GITLEAKS_IMAGE,
  TRIVY_IMAGE,
  SEMGREP_IMAGE,
  SHELLCHECK_IMAGE,
  MAVEN_IMAGE,
  TEXLIVE_IMAGE,
  CADDY_IMAGE,
  PYTHON_IMAGE,
  SOURCE_EXCLUDES,
} from "../constants";

describe("image constants", () => {
  const images = [
    { name: "BUN_IMAGE", value: BUN_IMAGE },
    { name: "RUST_IMAGE", value: RUST_IMAGE },
    { name: "GO_IMAGE", value: GO_IMAGE },
    { name: "PLAYWRIGHT_IMAGE", value: PLAYWRIGHT_IMAGE },
    { name: "SWIFTLINT_IMAGE", value: SWIFTLINT_IMAGE },
    { name: "ALPINE_IMAGE", value: ALPINE_IMAGE },
    { name: "TOFU_IMAGE", value: TOFU_IMAGE },
    { name: "GITLEAKS_IMAGE", value: GITLEAKS_IMAGE },
    { name: "TRIVY_IMAGE", value: TRIVY_IMAGE },
    { name: "SEMGREP_IMAGE", value: SEMGREP_IMAGE },
    { name: "SHELLCHECK_IMAGE", value: SHELLCHECK_IMAGE },
    { name: "MAVEN_IMAGE", value: MAVEN_IMAGE },
    { name: "TEXLIVE_IMAGE", value: TEXLIVE_IMAGE },
    { name: "CADDY_IMAGE", value: CADDY_IMAGE },
    { name: "PYTHON_IMAGE", value: PYTHON_IMAGE },
  ];

  for (const { name, value } of images) {
    it(`${name} contains a version tag (not :latest or :stable)`, () => {
      // Must contain a colon separating image name from tag
      assert.ok(value.includes(":"));
      const tag = value.split(":").pop()!;
      // Tag must not be "latest" or "stable"
      assert.notStrictEqual(tag, "latest");
      assert.notStrictEqual(tag, "stable");
      // Tag should contain at least one digit (version number)
      assert.match(tag, /\d/);
    });
  }
});

describe("SOURCE_EXCLUDES", () => {
  it("contains .git exclusion", () => {
    assert.ok(SOURCE_EXCLUDES.includes(".git"));
  });

  it("contains node_modules exclusion", () => {
    assert.ok(SOURCE_EXCLUDES.includes("**/node_modules"));
  });

  it("contains dist exclusion", () => {
    assert.ok(SOURCE_EXCLUDES.includes("**/dist"));
  });

  it("contains target exclusion (for Rust/cargo)", () => {
    assert.ok(SOURCE_EXCLUDES.includes("**/target"));
  });

  it("contains archive exclusion", () => {
    assert.ok(SOURCE_EXCLUDES.includes("**/archive"));
  });
});
