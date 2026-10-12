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
            Error::Io(e) if e.kind() == std::io::ErrorKind::StorageFull => (
                "There's not enough space",
                "Free some space on your game drive, then try again.",
            ),
            Error::Io(e) if e.kind() == std::io::ErrorKind::PermissionDenied => (
                "Windows couldn't access a file",
                "Close the game and its launcher, then try again. If this continues, save a support report from Help.",
            ),
            Error::Archive(_) => (
                "The game files couldn't be unpacked",
                "Try again. If this continues, save a support report from Help.",
            ),
            _ => match activity {
                Activity::Installation => (
                    "Setup couldn't finish",
                    "Try again. If this continues, save a support report from Help.",
                ),
                Activity::Launch => (
                    "The game couldn't open",
                    "Close the game and its launcher, then try again. Open Details for the next step.",
                ),
                Activity::Launcher => (
                    "Something needs attention",
                    "Restart Glitter Boys. If this continues, save a support report from Help.",
                ),
            },
        };
        Self::new(title, next_step, error.to_string())
    }
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
}
