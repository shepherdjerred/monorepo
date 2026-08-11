//! The Swift binding generator, re-exposed as a workspace binary.
//!
//! `uniffi` declares `uniffi-bindgen-swift` with
//! `required-features = ["cli"]`, so depending on the crate never builds it.
//! Re-declaring it here means the generator is compiled from the *same* pinned
//! `=0.31.2` source tree as the runtime scaffolding it has to agree with, and
//! `cargo run` reaches it with no global install and no second version to keep
//! in sync.
//!
//! `cargo xtask` is the only thing expected to invoke this; see
//! `xtask/src/swift.rs` for the flags, which are not optional — a missing
//! `--module-name` produces bindings that compile to 139 "cannot find type
//! `RustBuffer` in scope" errors.

fn main() {
    uniffi::uniffi_bindgen_swift();
}
