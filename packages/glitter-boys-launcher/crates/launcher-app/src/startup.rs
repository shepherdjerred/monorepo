//! Explicit bootstrap options for isolated acceptance runs.
use glitter_boys_core::{Error, Result, state};
use std::{ffi::OsString, path::PathBuf};

pub struct Startup {
    pub data: PathBuf,
    pub resume: bool,
}
impl Startup {
    pub fn parse(args: impl IntoIterator<Item = OsString>) -> Result<Self> {
        let mut data = None;
        let mut resume = false;
        let mut args = args.into_iter();
        while let Some(arg) = args.next() {
            if arg == "--data-dir" && data.is_none() {
                let path = PathBuf::from(args.next().ok_or_else(|| {
                    Error::Invalid("--data-dir needs an absolute directory".into())
                })?);
                if !path.is_absolute() {
                    return Err(Error::Invalid(
                        "--data-dir needs an absolute directory".into(),
                    ));
                }
                data = Some(path);
            } else if arg == "--resume" && !resume {
                resume = true;
            } else {
                return Err(Error::Invalid(
                    "Usage: glitter-boys [--data-dir <absolute directory>] [--resume]".into(),
                ));
            }
        }
        Ok(Self {
            data: match data {
                Some(path) => path,
                None => state::data_directory()?,
            },
            resume,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn isolated_profile_and_resume_are_explicit() -> Result<()> {
        let directory = tempfile::tempdir()?;
        let startup = Startup::parse([
            OsString::from("--data-dir"),
            directory.path().as_os_str().to_owned(),
            OsString::from("--resume"),
        ])?;
        assert_eq!(startup.data, directory.path());
        assert!(startup.resume);
        assert!(!Startup::parse([])?.resume);
        Ok(())
    }
    #[test]
    fn malformed_options_fail_before_starting_work() {
        for args in [
            vec!["--data-dir"],
            vec!["--data-dir", "relative"],
            vec!["--resume", "--resume"],
            vec!["--unexpected"],
        ] {
            assert!(Startup::parse(args.into_iter().map(OsString::from)).is_err());
        }
    }
}
