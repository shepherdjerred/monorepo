import { describe, it, expect } from "bun:test";

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

  it.each(images)(
    "$name contains a version tag (not :latest or :stable)",
    ({ value }) => {
      // Must contain a colon separating image name from tag
      expect(value).toContain(":");
      const tag = value.split(":").pop()!;
      // Tag must not be "latest" or "stable"
      expect(tag).not.toBe("latest");
      expect(tag).not.toBe("stable");
      // Tag should contain at least one digit (version number)
      expect(tag).toMatch(/\d/);
    },
  );
});

describe("SOURCE_EXCLUDES", () => {
  it("contains .git exclusion", () => {
    expect(SOURCE_EXCLUDES).toContain(".git");
  });

  it("contains node_modules exclusion", () => {
    expect(SOURCE_EXCLUDES).toContain("**/node_modules");
  });

  it("contains dist exclusion", () => {
    expect(SOURCE_EXCLUDES).toContain("**/dist");
  });

  it("contains target exclusion (for Rust/cargo)", () => {
    expect(SOURCE_EXCLUDES).toContain("**/target");
  });

  it("contains archive exclusion", () => {
    expect(SOURCE_EXCLUDES).toContain("**/archive");
  });
});
