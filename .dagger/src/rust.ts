/**
 * Rust operation helper functions.
 *
 * These are plain functions (not decorated) — the @func() wrappers live in index.ts.
 */
import { Container, Directory } from "@dagger.io/dagger";

import { rustBaseContainer } from "./base";

/** Run cargo fmt --check. */
export function rustFmtHelper(pkgDir: Directory): Container {
  return rustBaseContainer(pkgDir)
    .withExec(["rustup", "component", "add", "rustfmt"])
    .withExec(["cargo", "fmt", "--check"]);
}

/** Run cargo clippy. */
export function rustClippyHelper(pkgDir: Directory): Container {
  return rustBaseContainer(pkgDir)
    .withExec(["rustup", "component", "add", "clippy"])
    .withExec([
      "cargo",
      "clippy",
      "--all-targets",
      "--all-features",
      "--",
      "-D",
      "warnings",
    ]);
}

/** Run cargo test. */
export function rustTestHelper(pkgDir: Directory): Container {
  return rustBaseContainer(pkgDir).withExec([
    "cargo",
    "test",
    "--all-features",
  ]);
}

/** Build the Rust project for a given target. */
export function rustBuildHelper(
  pkgDir: Directory,
  target: string = "x86_64-unknown-linux-gnu",
): Container {
  let container = rustBaseContainer(pkgDir).withExec([
    "rustup",
    "target",
    "add",
    target,
  ]);

  // Set cross-compilation env vars for aarch64
  if (target === "aarch64-unknown-linux-gnu") {
    container = container
      .withEnvVariable(
        "CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER",
        "aarch64-linux-gnu-gcc",
      )
      .withEnvVariable(
        "PKG_CONFIG_PATH",
        "/usr/lib/aarch64-linux-gnu/pkgconfig",
      )
      .withEnvVariable("PKG_CONFIG_SYSROOT_DIR", "/usr/aarch64-linux-gnu")
      // Override .cargo/config.toml: use aarch64 gcc instead of clang+mold
      .withExec([
        "sh",
        "-c",
        `sed -i '/\\[target.aarch64-unknown-linux-gnu\\]/,/^\\[/{s/linker = .*/linker = "aarch64-linux-gnu-gcc"/; s/rustflags = .*/rustflags = []/}' .cargo/config.toml`,
      ]);
  }

  return container.withExec([
    "cargo",
    "build",
    "--release",
    "--target",
    target,
  ]);
}
