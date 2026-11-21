//! The built `scout-client` contains the proactive trigger sender exactly
//! when it is a beta build.
//!
//! Riot's published policy prohibits unprompted alerts from live game state,
//! so a stable build must not be able to send a `coach/triggers` request at
//! all. `cfg(scout_proactive_coach)` keeps the sender out of the source a
//! stable build compiles. This test reads the binary Cargo built for this
//! profile and checks that what it contains agrees:
//!
//! - the diagnostic operation the supervisor records when it asks Scout for
//!   a proactive turn, a string only that code path holds;
//! - where the binary carries its own symbol table (not Windows, whose
//!   symbols live in a separate PDB), the `start_coach_trigger` sender and
//!   `live::detectors::detect`.
//!
//! The beta run of the same test is the positive control: it proves the
//! search finds them when they are there. CI runs the workspace tests in both
//! profiles (`ci-tests.json`).

use std::error::Error;

/// The diagnostic operation of a proactive request
/// (`supervisor::PROACTIVE_TRIGGER_OPERATION`).
const OPERATION: &[u8] = b"proactive_coach_trigger";
/// The sender's name, as every symbol mangling spells it.
const SENDER: &[u8] = b"start_coach_trigger";
/// `live::detectors::detect`, as both Rust manglings spell its last two
/// path segments.
const DETECT: &[u8] = b"9detectors6detect";

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    let Some((&first, rest)) = needle.split_first() else {
        return true;
    };
    let mut from = 0;
    while let Some(offset) = haystack[from..].iter().position(|byte| *byte == first) {
        let at = from + offset;
        if haystack[at + 1..].starts_with(rest) {
            return true;
        }
        from = at + 1;
    }
    false
}

#[test]
fn the_binary_holds_a_trigger_sender_only_in_the_beta_profile() -> Result<(), Box<dyn Error>> {
    let binary = std::fs::read(env!("CARGO_BIN_EXE_scout-client"))?;
    let beta = cfg!(scout_proactive_coach);
    assert_eq!(
        contains(&binary, OPERATION),
        beta,
        "the proactive request path is in the binary exactly when it is a beta build"
    );
    if cfg!(not(windows)) {
        assert_eq!(
            contains(&binary, SENDER),
            beta,
            "the coach/triggers sender is in the binary exactly when it is a beta build"
        );
        assert_eq!(
            contains(&binary, DETECT),
            beta,
            "the detectors are in the binary exactly when it is a beta build"
        );
    }
    Ok(())
}

#[test]
fn the_search_finds_a_needle_anywhere_and_only_whole() {
    assert!(contains(b"abc proactive_coach_trigger", OPERATION));
    assert!(contains(OPERATION, OPERATION));
    assert!(!contains(b"proactive_coach_trigge", OPERATION));
    assert!(!contains(b"", SENDER));
}
