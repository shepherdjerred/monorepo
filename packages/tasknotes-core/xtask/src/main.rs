//! `cargo xtask` — build orchestration for the TaskNotes core workspace.
//!
//! Two responsibilities, deliberately separable:
//!
//! * **Binding generation** (`generate-bindings`, `check-bindings`) needs only
//!   `cargo` and runs anywhere the workspace compiles, Linux included. That is
//!   the per-PR CI story: `check-bindings` is gate 7, the only mechanical guard
//!   against UniFFI's silent `Record`-reordering corruption.
//! * **Packaging** (`build-xcframework`, `verify-swift`) needs `lipo`,
//!   `xcodebuild`, and a Swift toolchain, so it is macOS-only and is not on the
//!   Linux path.
//!
//! Cargo must never run from an Xcode build phase; this binary is the only
//! entry point that drives it.

mod csharp;
mod process;
mod swift;

use std::process::ExitCode;

const USAGE: &str = "\
cargo xtask — TaskNotes core build orchestration

USAGE:
    cargo xtask <COMMAND> [OPTIONS]

COMMANDS:
    generate-bindings   Regenerate the committed Swift and C# bindings
    check-bindings      Regenerate them, then fail if a committed copy moved
    build-xcframework   Build the Apple static libraries and package them
    check-xcframework   Fail if the built XCFramework predates the bindings
    verify-swift        Compile and run a Swift smoke test against the package
    help                Print this message

OPTIONS:
    --profile <NAME>    Cargo profile to build with
                        [default: dev for bindings, reldbg for packaging]
    --platform <NAME>   Apple platform slice, repeatable [default: macos]
                        One of: macos, ios, ios-sim

NOTES:
    generate-bindings and check-bindings run on any host, Linux included. They
    build the source-controlled, pinned C# UniFFI generator retarget.
    build-xcframework and verify-swift require macOS.
    check-xcframework only compares timestamps, so it runs anywhere — but it
    can only pass where build-xcframework has run.
";

fn main() -> ExitCode {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    match dispatch(&arguments) {
        Ok(output) => {
            print!("{output}");
            ExitCode::SUCCESS
        }
        Err(message) => {
            eprintln!("error: {message}\n\n{USAGE}");
            ExitCode::FAILURE
        }
    }
}

/// Route parsed arguments to a command, returning what to print on success or
/// why the invocation was rejected.
fn dispatch(arguments: &[String]) -> Result<String, String> {
    match parse(arguments)? {
        Command::Help => Ok(USAGE.to_owned()),
        Command::GenerateBindings { profile } => {
            let swift = swift::generate_bindings(&profile)?;
            let csharp = csharp::generate_bindings(&profile)?;
            Ok(format!("{swift}{csharp}"))
        }
        Command::CheckBindings { profile } => {
            let swift = swift::check_bindings(&profile)?;
            let csharp = csharp::check_bindings(&profile)?;
            Ok(format!("{swift}{csharp}"))
        }
        Command::BuildXcframework { profile, platforms } => {
            swift::build_xcframework(&profile, &platforms)
        }
        Command::CheckXcframework => swift::check_xcframework(),
        Command::VerifySwift { profile, platforms } => swift::verify_swift(&profile, &platforms),
    }
}

/// The default cargo profile for binding generation.
///
/// `dev`, deliberately. The generator reads UniFFI's exported metadata out of
/// the library's symbol table, and that metadata is identical at every
/// optimisation level — so the drift check gets to reuse the debug artifacts
/// `cargo test` already built instead of paying for a fresh `lto = "thin"`,
/// `codegen-units = 1` build on every CI run. Gate 7 has to be cheap enough
/// that nobody is tempted to move it off the per-PR path.
const DEFAULT_BINDINGS_PROFILE: &str = "dev";

/// The default cargo profile for anything that produces a shippable artifact.
///
/// `reldbg` is release codegen with full DWARF retained. Release codegen is not
/// a nicety here: matrix-rust-sdk hit `EXC_BAD_ACCESS` shipping dev-profile
/// builds into an Apple host, and the retained debug info is what lets the
/// app's link step produce a symbolicated `.dSYM` later.
const DEFAULT_PACKAGE_PROFILE: &str = "reldbg";

/// A parsed invocation.
///
/// Parsing is split from execution so the argument grammar is unit-testable
/// without running a build.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Command {
    /// Print usage.
    Help,
    /// Regenerate the committed bindings.
    GenerateBindings {
        /// The cargo profile to build the metadata-bearing library with.
        profile: String,
    },
    /// Regenerate the committed bindings and fail if they moved.
    CheckBindings {
        /// The cargo profile to build the metadata-bearing library with.
        profile: String,
    },
    /// Build the Apple static libraries and package them as an XCFramework.
    BuildXcframework {
        /// The cargo profile to build with.
        profile: String,
        /// The platform slices to include.
        platforms: Vec<swift::Platform>,
    },
    /// Fail if the built XCFramework predates the committed bindings.
    CheckXcframework,
    /// Build the package and run a Swift smoke test against it.
    VerifySwift {
        /// The cargo profile to build with.
        profile: String,
        /// The platform slices to include.
        platforms: Vec<swift::Platform>,
    },
}

/// Parse an argument vector into a [`Command`].
fn parse(arguments: &[String]) -> Result<Command, String> {
    let Some(command) = arguments.first() else {
        return Ok(Command::Help);
    };
    let rest = arguments.get(1..).unwrap_or_default();

    match command.as_str() {
        "help" | "-h" | "--help" => {
            if rest.is_empty() {
                Ok(Command::Help)
            } else {
                Err(format!("help takes no arguments, got {rest:?}"))
            }
        }
        "generate-bindings" => Ok(Command::GenerateBindings {
            profile: parse_options(rest, false, DEFAULT_BINDINGS_PROFILE)?.profile,
        }),
        "check-bindings" => Ok(Command::CheckBindings {
            profile: parse_options(rest, false, DEFAULT_BINDINGS_PROFILE)?.profile,
        }),
        "build-xcframework" => {
            let options = parse_options(rest, true, DEFAULT_PACKAGE_PROFILE)?;
            Ok(Command::BuildXcframework {
                profile: options.profile,
                platforms: options.platforms,
            })
        }
        "check-xcframework" => {
            if rest.is_empty() {
                Ok(Command::CheckXcframework)
            } else {
                Err(format!(
                    "check-xcframework takes no arguments, got {rest:?}"
                ))
            }
        }
        "verify-swift" => {
            let options = parse_options(rest, true, DEFAULT_PACKAGE_PROFILE)?;
            Ok(Command::VerifySwift {
                profile: options.profile,
                platforms: options.platforms,
            })
        }
        other => Err(format!("unknown command {other:?}")),
    }
}

/// The options a command accepted, with defaults already applied.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Options {
    /// The cargo profile.
    profile: String,
    /// The requested platform slices, in the order given.
    platforms: Vec<swift::Platform>,
}

/// Parse `--profile` and, when `accepts_platforms`, `--platform`.
///
/// Written by hand rather than with `clap` because xtask is deliberately
/// dependency-free: it is the tool that has to work before anything else is
/// guaranteed to.
fn parse_options(
    arguments: &[String],
    accepts_platforms: bool,
    default_profile: &str,
) -> Result<Options, String> {
    let mut profile: Option<String> = None;
    let mut platforms: Vec<swift::Platform> = Vec::new();
    let mut remaining = arguments.iter();

    while let Some(argument) = remaining.next() {
        match argument.as_str() {
            "--profile" => {
                let value = remaining
                    .next()
                    .ok_or_else(|| "--profile needs a value".to_owned())?;
                if profile.is_some() {
                    return Err("--profile was given more than once".to_owned());
                }
                profile = Some(value.clone());
            }
            "--platform" if accepts_platforms => {
                let value = remaining
                    .next()
                    .ok_or_else(|| "--platform needs a value".to_owned())?;
                let platform = swift::Platform::parse(value)?;
                if platforms.contains(&platform) {
                    return Err(format!("--platform {value} was given more than once"));
                }
                platforms.push(platform);
            }
            other => return Err(format!("unexpected argument {other:?}")),
        }
    }

    if platforms.is_empty() {
        platforms.push(swift::Platform::MacOs);
    }

    Ok(Options {
        profile: profile.unwrap_or_else(|| default_profile.to_owned()),
        platforms,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        Command, DEFAULT_BINDINGS_PROFILE, DEFAULT_PACKAGE_PROFILE, USAGE, dispatch, parse,
    };
    use crate::swift::Platform;

    fn arguments(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn no_arguments_prints_usage() {
        assert_eq!(dispatch(&[]).unwrap(), USAGE);
    }

    #[test]
    fn help_prints_usage() {
        for alias in ["help", "-h", "--help"] {
            assert_eq!(dispatch(&arguments(&[alias])).unwrap(), USAGE);
        }
    }

    #[test]
    fn unknown_commands_are_rejected() {
        let error = parse(&arguments(&["swift"])).unwrap_err();
        assert_eq!(error, "unknown command \"swift\"");
    }

    #[test]
    fn extra_arguments_to_help_are_rejected() {
        let error = parse(&arguments(&["help", "swift"])).unwrap_err();
        assert_eq!(error, "help takes no arguments, got [\"swift\"]");
    }

    #[test]
    fn the_xcframework_check_takes_no_options() {
        assert_eq!(
            parse(&arguments(&["check-xcframework"])).unwrap(),
            Command::CheckXcframework
        );
        // Rejected rather than ignored: it compares two paths this crate already
        // knows, so a `--profile` or `--platform` here means the caller expects
        // it to check a slice it will not check.
        let error = parse(&arguments(&["check-xcframework", "--platform", "ios"])).unwrap_err();
        assert_eq!(
            error,
            "check-xcframework takes no arguments, got [\"--platform\", \"ios\"]"
        );
    }

    #[test]
    fn the_binding_commands_default_to_the_cheap_profile() {
        assert_eq!(
            parse(&arguments(&["generate-bindings"])).unwrap(),
            Command::GenerateBindings {
                profile: DEFAULT_BINDINGS_PROFILE.to_owned()
            }
        );
        assert_eq!(
            parse(&arguments(&["check-bindings", "--profile", "release"])).unwrap(),
            Command::CheckBindings {
                profile: "release".to_owned()
            }
        );
    }

    #[test]
    fn packaging_defaults_to_the_release_debuggable_profile() {
        assert_ne!(DEFAULT_BINDINGS_PROFILE, DEFAULT_PACKAGE_PROFILE);
        assert_eq!(DEFAULT_PACKAGE_PROFILE, "reldbg");
    }

    #[test]
    fn the_binding_commands_do_not_take_a_platform() {
        let error = parse(&arguments(&["generate-bindings", "--platform", "macos"])).unwrap_err();
        assert_eq!(error, "unexpected argument \"--platform\"");
    }

    #[test]
    fn packaging_defaults_to_the_macos_slice_alone() {
        assert_eq!(
            parse(&arguments(&["build-xcframework"])).unwrap(),
            Command::BuildXcframework {
                profile: DEFAULT_PACKAGE_PROFILE.to_owned(),
                platforms: vec![Platform::MacOs],
            }
        );
    }

    #[test]
    fn platforms_accumulate_in_the_order_given() {
        assert_eq!(
            parse(&arguments(&[
                "build-xcframework",
                "--platform",
                "ios-sim",
                "--platform",
                "macos",
            ]))
            .unwrap(),
            Command::BuildXcframework {
                profile: DEFAULT_PACKAGE_PROFILE.to_owned(),
                platforms: vec![Platform::IosSimulator, Platform::MacOs],
            }
        );
    }

    #[test]
    fn a_repeated_or_unknown_option_is_rejected() {
        for (given, expected) in [
            (
                vec![
                    "build-xcframework",
                    "--platform",
                    "macos",
                    "--platform",
                    "macos",
                ],
                "--platform macos was given more than once",
            ),
            (
                vec!["build-xcframework", "--profile", "a", "--profile", "b"],
                "--profile was given more than once",
            ),
            (
                vec!["build-xcframework", "--platform", "watchos"],
                "unknown platform \"watchos\"; expected one of macos, ios, ios-sim",
            ),
            (
                vec!["build-xcframework", "--profile"],
                "--profile needs a value",
            ),
            (
                vec!["build-xcframework", "--platform"],
                "--platform needs a value",
            ),
        ] {
            assert_eq!(parse(&arguments(&given)).unwrap_err(), expected);
        }
    }

    #[test]
    fn verify_swift_takes_the_same_options_as_packaging() {
        assert_eq!(
            parse(&arguments(&["verify-swift", "--profile", "release"])).unwrap(),
            Command::VerifySwift {
                profile: "release".to_owned(),
                platforms: vec![Platform::MacOs],
            }
        );
    }
}
