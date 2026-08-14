//! Running external programs, loudly.
//!
//! Every helper here fails on a non-zero exit status and says which program
//! failed and how. Nothing swallows stderr, nothing falls back to a default,
//! and nothing continues past a failure — a build tool that hides a broken
//! sub-process produces artifacts nobody can trust.

use std::{
    ffi::OsStr,
    path::Path,
    process::{Command, Stdio},
};

/// Run a program, streaming its output, and fail on a non-zero exit.
///
/// # Errors
///
/// Returns a message when the program could not be spawned (usually: it is not
/// installed) or exited non-zero.
pub fn run<S: AsRef<OsStr>>(
    program: &str,
    arguments: &[S],
    working_directory: &Path,
) -> Result<(), String> {
    run_with_env(program, arguments, working_directory, &[])
}

/// Run a program with extra environment variables set.
///
/// Passing the environment per-process rather than through
/// `std::env::set_var` is not a style preference: `set_var` is `unsafe` in
/// edition 2024, and hand-written `unsafe` is denied workspace-wide.
///
/// # Errors
///
/// As [`run`].
pub fn run_with_env<S: AsRef<OsStr>>(
    program: &str,
    arguments: &[S],
    working_directory: &Path,
    environment: &[(&str, &str)],
) -> Result<(), String> {
    let rendered = render(program, arguments);
    println!("  $ {rendered}");

    let status = Command::new(program)
        .args(arguments)
        .envs(environment.iter().copied())
        .current_dir(working_directory)
        .stdin(Stdio::null())
        .status()
        .map_err(|error| format!("could not run `{rendered}`: {error}"))?;

    if status.success() {
        return Ok(());
    }
    Err(match status.code() {
        Some(code) => format!("`{rendered}` exited with status {code}"),
        None => format!("`{rendered}` was killed by a signal"),
    })
}

/// Run a program and capture its standard output, failing on a non-zero exit.
///
/// Standard error is inherited rather than captured, so a failure is visible in
/// the build log even though its output is being read.
///
/// # Errors
///
/// Returns a message when the program could not be spawned, exited non-zero, or
/// wrote output that is not UTF-8.
pub fn capture<S: AsRef<OsStr>>(
    program: &str,
    arguments: &[S],
    working_directory: &Path,
) -> Result<String, String> {
    let rendered = render(program, arguments);

    let output = Command::new(program)
        .args(arguments)
        .current_dir(working_directory)
        .stdin(Stdio::null())
        .stderr(Stdio::inherit())
        .output()
        .map_err(|error| format!("could not run `{rendered}`: {error}"))?;

    if !output.status.success() {
        return Err(match output.status.code() {
            Some(code) => format!("`{rendered}` exited with status {code}"),
            None => format!("`{rendered}` was killed by a signal"),
        });
    }

    String::from_utf8(output.stdout)
        .map_err(|error| format!("`{rendered}` wrote output that is not UTF-8: {error}"))
}

/// Run a program, returning whether it succeeded rather than failing.
///
/// Used only where a non-zero exit is *the answer* rather than an error — the
/// `git diff --exit-code` drift check. Output is streamed, so the diff itself
/// still reaches the build log.
///
/// # Errors
///
/// Returns a message only when the program could not be spawned at all.
pub fn succeeded<S: AsRef<OsStr>>(
    program: &str,
    arguments: &[S],
    working_directory: &Path,
) -> Result<bool, String> {
    let rendered = render(program, arguments);
    println!("  $ {rendered}");

    Command::new(program)
        .args(arguments)
        .current_dir(working_directory)
        .stdin(Stdio::null())
        .status()
        .map(|status| status.success())
        .map_err(|error| format!("could not run `{rendered}`: {error}"))
}

/// Render a command line for a log message or an error.
fn render<S: AsRef<OsStr>>(program: &str, arguments: &[S]) -> String {
    let mut rendered = program.to_owned();
    for argument in arguments {
        rendered.push(' ');
        rendered.push_str(&argument.as_ref().to_string_lossy());
    }
    rendered
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{capture, render, run, succeeded};

    /// An explicitly typed empty argument list.
    ///
    /// Spelled as a constant rather than `&[] as &[&str]`, which is a cast and
    /// so is denied workspace-wide.
    const NO_ARGUMENTS: &[&str] = &[];

    #[test]
    fn renders_a_command_line_for_diagnostics() {
        assert_eq!(render("cargo", &["build", "--lib"]), "cargo build --lib");
        assert_eq!(render("lipo", NO_ARGUMENTS), "lipo");
    }

    #[test]
    fn a_non_zero_exit_is_an_error_naming_the_command() {
        let (program, arguments) = failure_command();
        let error = run(program, arguments, Path::new(".")).unwrap_err();
        assert_eq!(
            error,
            format!("`{}` exited with status 1", render(program, arguments))
        );
    }

    #[test]
    fn a_missing_program_is_an_error_naming_the_command() {
        let error = run(
            "definitely-not-installed-xtask-probe",
            NO_ARGUMENTS,
            Path::new("."),
        )
        .unwrap_err();
        assert!(
            error.starts_with("could not run `definitely-not-installed-xtask-probe`"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn captures_standard_output() {
        let (program, arguments) = echo_command();
        let output = capture(program, arguments, Path::new(".")).unwrap();
        assert_eq!(output.trim_end(), "hello");
    }

    #[test]
    fn reports_success_without_failing() {
        let (success_program, success_arguments) = success_command();
        assert!(succeeded(success_program, success_arguments, Path::new(".")).unwrap());
        let (failure_program, failure_arguments) = failure_command();
        assert!(!succeeded(failure_program, failure_arguments, Path::new(".")).unwrap());
    }

    fn success_command() -> (&'static str, &'static [&'static str]) {
        if cfg!(windows) {
            ("cmd.exe", &["/d", "/c", "exit 0"])
        } else {
            ("true", NO_ARGUMENTS)
        }
    }

    fn failure_command() -> (&'static str, &'static [&'static str]) {
        if cfg!(windows) {
            ("cmd.exe", &["/d", "/c", "exit 1"])
        } else {
            ("false", NO_ARGUMENTS)
        }
    }

    fn echo_command() -> (&'static str, &'static [&'static str]) {
        if cfg!(windows) {
            ("cmd.exe", &["/d", "/c", "echo hello"])
        } else {
            ("echo", &["hello"])
        }
    }
}
