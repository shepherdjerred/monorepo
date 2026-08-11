//! The shared test harness: the fake server, the injected capabilities, the
//! fixture format, and the scenario interpreter.
//!
//! Marked `#[cfg(test)]` by every consumer, which is accurate — none of this
//! ships — and which is also what tells clippy that an `unwrap` here is an
//! assertion rather than a hazard.

pub mod fake_server;
pub mod harness;
pub mod model;
pub mod runner;

use std::path::PathBuf;

use model::Scenario;

/// Where `@tasknotes/fixtures` lives, relative to this crate.
///
/// A path rather than `include_str!` on purpose: the corpus is discovered at
/// run time, so a scenario added to the package is picked up without anyone
/// remembering to register it here.
pub fn scenario_directory() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../tasknotes-fixtures/scenarios")
}

/// Every scenario in the shared corpus, sorted by file name.
///
/// # Panics
///
/// The corpus directory is missing, unreadable, or holds a file that is not a
/// valid scenario. All three are drift signals rather than test failures, and
/// none of them should be reported as "one scenario is red".
pub fn load_scenarios() -> Vec<Scenario> {
    let directory = scenario_directory();
    let mut paths: Vec<PathBuf> = std::fs::read_dir(&directory)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", directory.display()))
        .map(|entry| entry.expect("a readable directory entry").path())
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension == "json")
        })
        .collect();
    paths.sort();

    paths
        .into_iter()
        .map(|path| {
            let raw = std::fs::read_to_string(&path)
                .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()));
            let scenario: Scenario = serde_json::from_str(&raw)
                .unwrap_or_else(|error| panic!("{} is not a scenario: {error}", path.display()));
            let stem = path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or_default();
            assert_eq!(
                scenario.id,
                stem,
                "{} declares a different id",
                path.display()
            );
            scenario
        })
        .collect()
}
