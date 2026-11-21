//! Sets `cfg(scout_proactive_coach)` for the beta profile, so the proactive
//! coach's IPC exists only in a beta build.

#[path = "../../build-support/proactive_coach.rs"]
mod proactive_coach;

fn main() -> Result<(), String> {
    proactive_coach::emit()
}
