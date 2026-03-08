"""Cargo-deny license/advisory/ban checking via custom rule.

Runs cargo-deny check inside the Bazel sandbox via a shell wrapper.
Uses a hermetic cargo-deny binary from @multitool and cargo from @rules_rust.
Needs network access to fetch advisory database.
"""

def _cargo_deny_test_impl(ctx):
    toolchain = ctx.toolchains[Label("@rules_rust//rust:toolchain_type")]
    cargo = toolchain.cargo
    rustc = toolchain.rustc

    runner = ctx.executable._runner
    cargo_deny = ctx.executable._cargo_deny

    # Build runfiles from all sources + the runner script itself + toolchain binaries
    runfiles = ctx.runfiles(files = ctx.files.srcs + [cargo, rustc, cargo_deny, runner])

    # Create a wrapper script that sets env vars and delegates to the runner
    wrapper = ctx.actions.declare_file(ctx.label.name + "_wrapper.sh")
    ctx.actions.write(
        output = wrapper,
        content = """\
#!/usr/bin/env bash
export PKG_DIR="{pkg_dir}"
export CARGO_DENY_BIN="{cargo_deny}"
export CARGO_BIN="{cargo}"
export RUSTC_BIN="{rustc}"
exec "{runner}" "$@"
""".format(
            pkg_dir = ctx.label.package,
            cargo_deny = cargo_deny.short_path,
            cargo = cargo.short_path,
            rustc = rustc.short_path,
            runner = runner.short_path,
        ),
        is_executable = True,
    )

    return [DefaultInfo(
        executable = wrapper,
        runfiles = runfiles,
    )]

cargo_deny_test = rule(
    implementation = _cargo_deny_test_impl,
    test = True,
    attrs = {
        "srcs": attr.label_list(
            doc = "Must include Cargo.toml, Cargo.lock, and deny.toml",
            allow_files = True,
        ),
        "_runner": attr.label(
            default = "//tools/bazel:cargo_deny_runner.sh",
            executable = True,
            cfg = "exec",
            allow_single_file = True,
        ),
        "_cargo_deny": attr.label(
            default = "@multitool//tools/cargo-deny",
            executable = True,
            cfg = "exec",
            allow_single_file = True,
        ),
    },
    toolchains = ["@rules_rust//rust:toolchain_type"],
)
