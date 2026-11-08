//! User-facing recovery guidance, separate from technical error details.
use crate::Error;

#[derive(Clone, Debug)]
pub struct Problem {
    pub title: &'static str,
    pub next_step: &'static str,
    pub details: String,
}
#[derive(Clone, Copy)]
pub enum Activity {
    Installation,
    Launch,
    Launcher,
}

impl Problem {
    pub fn new(title: &'static str, next_step: &'static str, details: impl Into<String>) -> Self {
        Self {
            title,
            next_step,
            details: details.into(),
        }
    }
    pub fn from_error(error: &Error, activity: Activity) -> Self {
        let (title, next_step) = match error {
            Error::ActionRequired { title, next_step } => (*title, *next_step),
            Error::Network(_) => (
                "The download couldn't finish",
                "Check your connection, then try again. Saved downloads will be reused.",
            ),
            Error::Archive(_) => (
                "The game files couldn't be unpacked",
                "Try again. If this continues, save a support bundle from Help and send it to Jerred.",
            ),
            _ => match error.io().and_then(|io| io_guidance(io, error.step())) {
                Some(guidance) => guidance,
                None => match activity {
                    Activity::Installation => (
                        "Setup couldn't finish",
                        "Save a support bundle from Get help and send it to Jerred, then try again.",
                    ),
                    Activity::Launch => (
                        "The game couldn't open",
                        "Close the game and its launcher, then try again. If this continues, save a support bundle from Get help.",
                    ),
                    Activity::Launcher => (
                        "Something needs attention",
                        "Restart Glitter Boys. If this continues, save a support bundle from Help.",
                    ),
                },
            },
        };
        tracing::warn!(title, error = %error, chain = %error_chain(error), "problem shown");
        Self::new(title, next_step, details(error))
    }
}

const ERROR_SHARING_VIOLATION: i32 = 32;
const ERROR_LOCK_VIOLATION: i32 = 33;
const ERROR_VIRUS_INFECTED: i32 = 225;
const ERROR_VIRUS_DELETED: i32 = 226;
const ERROR_ELEVATION_REQUIRED: i32 = 740;
const ERROR_SYSTEM_INTEGRITY_POLICY_VIOLATION: i32 = 4551;

/// Recovery guidance for OS-level failures, by Windows error code first and kind second.
fn io_guidance(
    error: &std::io::Error,
    step: Option<crate::Step>,
) -> Option<(&'static str, &'static str)> {
    use crate::Step;
    // These are Windows error codes; the same numbers mean other things elsewhere.
    let windows_code = if cfg!(windows) {
        error.raw_os_error()
    } else {
        None
    };
    match windows_code {
        Some(ERROR_SHARING_VIOLATION | ERROR_LOCK_VIOLATION) => {
            return Some((
                "A game file is in use",
                "Close the game, its launcher, and any window open in the game folder, then try again.",
            ));
        }
        Some(
            ERROR_VIRUS_INFECTED | ERROR_VIRUS_DELETED | ERROR_SYSTEM_INTEGRITY_POLICY_VIOLATION,
        ) => {
            return Some((
                "Windows Security blocked a game file",
                "Open Windows Security → Protection history, allow the blocked file, then try again.",
            ));
        }
        Some(ERROR_ELEVATION_REQUIRED) => {
            return Some((
                "This step needs administrator approval",
                "Try again and approve the Windows prompt. If no prompt appears, save a support bundle from Get help.",
            ));
        }
        _ => {}
    }
    match error.kind() {
        std::io::ErrorKind::StorageFull => Some((
            "There's not enough space",
            "Free some space on your game drive, then try again.",
        )),
        std::io::ErrorKind::PermissionDenied => Some((
            "Windows couldn't access a file",
            "Close the game and its launcher, then try again. If this continues, save a support bundle from Get help.",
        )),
        std::io::ErrorKind::NotFound
            if matches!(step, Some(Step::CopyClient | Step::SpawnUpdater)) =>
        {
            Some((
                "A game launcher file went missing",
                "Antivirus software may have removed it. Check Windows Security → Protection history, then try again.",
            ))
        }
        _ => None,
    }
}

/// Technical details for Copy error details and support bundles.
fn details(error: &Error) -> String {
    let mut text = error.to_string();
    if let Some(io) = error.io() {
        if let Some(code) = io.raw_os_error() {
            text.push_str(&format!(" [os error {code}, {:?}]", io.kind()));
        } else {
            text.push_str(&format!(" [{:?}]", io.kind()));
        }
    }
    text
}

/// Every `source()` in the error chain, for logs.
pub fn error_chain(error: &(dyn std::error::Error + 'static)) -> String {
    let mut parts = vec![error.to_string()];
    let mut current = error.source();
    while let Some(source) = current {
        parts.push(source.to_string());
        current = source.source();
    }
    parts.join(" ← ")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recovery_uses_error_types_not_message_matching() {
        let disk = Error::Io(std::io::Error::from(std::io::ErrorKind::StorageFull));
        assert_eq!(
            Problem::from_error(&disk, Activity::Installation).title,
            "There's not enough space"
        );
        let invalid = Error::Invalid("not enough space".into());
        assert_eq!(
            Problem::from_error(&invalid, Activity::Launch).title,
            "The game couldn't open"
        );
        assert_eq!(
            Problem::from_error(&invalid, Activity::Installation).details,
            "not enough space"
        );
    }

    #[test]
    fn missing_launcher_files_point_at_antivirus() {
        let missing = Error::Step {
            step: crate::Step::CopyClient,
            path: "iw4x-launcher.exe".into(),
            source: std::io::Error::from(std::io::ErrorKind::NotFound),
        };
        let problem = Problem::from_error(&missing, Activity::Installation);
        assert_eq!(problem.title, "A game launcher file went missing");
        assert!(problem.details.contains("Copying the game launcher failed"));
    }

    #[cfg(windows)]
    #[test]
    fn windows_error_codes_get_specific_guidance_with_step_context() {
        let step = |code: i32, step: crate::Step| Error::Step {
            step,
            path: std::path::PathBuf::from(r"C:\Games\.gb-stage-x\iw4x"),
            source: std::io::Error::from_raw_os_error(code),
        };
        let in_use = Problem::from_error(&step(32, crate::Step::Promote), Activity::Installation);
        assert_eq!(in_use.title, "A game file is in use");
        assert!(in_use.details.contains("Moving the game into place failed"));
        assert!(in_use.details.contains("os error 32"));
        assert_eq!(
            Problem::from_error(
                &step(225, crate::Step::SpawnUpdater),
                Activity::Installation
            )
            .title,
            "Windows Security blocked a game file"
        );
        assert_eq!(
            Problem::from_error(
                &step(740, crate::Step::SpawnUpdater),
                Activity::Installation
            )
            .title,
            "This step needs administrator approval"
        );
        let plain = Error::Io(std::io::Error::from_raw_os_error(32));
        assert_eq!(
            Problem::from_error(&plain, Activity::Launch).title,
            "A game file is in use"
        );
        let unknown = Error::Io(std::io::Error::from_raw_os_error(1117));
        assert_eq!(
            Problem::from_error(&unknown, Activity::Installation).title,
            "Setup couldn't finish"
        );
    }
}
