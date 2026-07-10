/**
 * Rust quality helpers — currently scout-for-lol's Tauri desktop crate.
 *
 * Runs `cargo fmt --check`, `cargo clippy -D warnings`, and `cargo test`
 * (mirroring packages/scout-for-lol/packages/desktop/.mise.toml tasks) inside
 * the pinned RUST_IMAGE. rustup reads src-tauri/rust-toolchain.toml, so the
 * toolchain (and rustfmt/clippy components) match local development exactly.
 *
 * Plain functions, not decorated — the `@func()` wrappers live in index.ts.
 */
import { dag, Container, Directory } from "@dagger.io/dagger";

import { RUST_IMAGE, SOURCE_EXCLUDES } from "./constants";

/**
 * Debian packages Tauri v2 needs to compile on Linux (webkit webview, gtk,
 * appindicator, rsvg). See https://v2.tauri.app/start/prerequisites/#linux.
 */
const TAURI_APT_DEPS = [
  "libwebkit2gtk-4.1-dev",
  "build-essential",
  "libxdo-dev",
  "libssl-dev",
  "libayatana-appindicator3-dev",
  "librsvg2-dev",
  "pkg-config",
];

function scoutDesktopRustBase(desktopDir: Directory): Container {
  return (
    dag
      .container()
      .from(RUST_IMAGE)
      .withExec(["apt-get", "update"])
      .withExec([
        "apt-get",
        "install",
        "-y",
        "--no-install-recommends",
        ...TAURI_APT_DEPS,
      ])
      .withMountedCache(
        "/usr/local/cargo/registry",
        dag.cacheVolume("cargo-registry"),
      )
      // Mount all of RUSTUP_HOME (not just toolchains/) — rustup stages
      // downloads in $RUSTUP_HOME/tmp and renames into toolchains/, which
      // fails with EXDEV if the two live on different devices. rustup
      // re-creates settings.toml on first use and resolves the toolchain
      // from src-tauri/rust-toolchain.toml.
      .withMountedCache("/usr/local/rustup", dag.cacheVolume("rustup-home"))
      .withWorkdir("/desktop")
      .withDirectory("/desktop", desktopDir, { exclude: SOURCE_EXCLUDES })
      // tauri::generate_context! embeds frontendDist (../dist relative to
      // src-tauri) at compile time; an empty stub satisfies fmt/clippy/test
      // without building the real frontend.
      .withExec(["mkdir", "-p", "dist"])
      .withWorkdir("/desktop/src-tauri")
      .withMountedCache(
        "/desktop/src-tauri/target",
        dag.cacheVolume("scout-desktop-target"),
      )
  );
}

/**
 * fmt + clippy + test for the scout desktop crate. Sequential in one
 * container so the compilation cache is shared across clippy and test.
 */
export function scoutDesktopRustHelper(desktopDir: Directory): Container {
  return scoutDesktopRustBase(desktopDir)
    .withExec(["cargo", "fmt", "--check"])
    .withExec([
      "cargo",
      "clippy",
      "--all-targets",
      "--all-features",
      "--",
      "-D",
      "warnings",
    ])
    .withExec(["cargo", "test"]);
}
