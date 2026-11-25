use std::path::{Path, PathBuf};

use crate::auth::BasicAuthCredentials;
use crate::error::AppError;

pub const DEFAULT_HOST: &str = "0.0.0.0";
pub const DEFAULT_PORT: u16 = 7370;
pub const DEFAULT_DATA_DIR: &str = "/var/lib/charts";
pub const DEFAULT_STATIC_DIR: &str = "/usr/share/charts/client";
pub const FALLBACK_STATIC_DIR: &str = "dist/client";
pub const DEFAULT_QUOTA_BYTES: u64 = 8_589_934_592; // 8 GiB

#[derive(Clone, Debug)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub data_dir: PathBuf,
    pub static_dir: PathBuf,
    pub quota_bytes: u64,
    pub basic_auth: Option<BasicAuthCredentials>,
}

impl Config {
    pub fn from_env() -> Result<Self, AppError> {
        let host = non_empty_env("HOST").unwrap_or_else(|| DEFAULT_HOST.to_owned());

        let port = match non_empty_env("PORT") {
            Some(raw) => raw
                .parse::<u16>()
                .map_err(|err| AppError::Config(format!("invalid PORT value '{raw}': {err}")))?,
            None => DEFAULT_PORT,
        };

        let data_dir = non_empty_env("CHARTS_DATA_DIR")
            .map_or_else(|| PathBuf::from(DEFAULT_DATA_DIR), PathBuf::from);

        let static_dir = resolve_static_dir(non_empty_env("CHARTS_STATIC_DIR").as_deref());

        let quota_bytes = match non_empty_env("CHARTS_QUOTA_BYTES") {
            Some(raw) => raw.parse::<u64>().map_err(|err| {
                AppError::Config(format!("invalid CHARTS_QUOTA_BYTES value '{raw}': {err}"))
            })?,
            None => DEFAULT_QUOTA_BYTES,
        };

        let basic_auth = resolve_basic_auth()?;

        Ok(Self {
            host,
            port,
            data_dir,
            static_dir,
            quota_bytes,
            basic_auth,
        })
    }
}

pub fn resolve_static_dir(configured: Option<&str>) -> PathBuf {
    if let Some(explicit) = configured {
        let candidate = PathBuf::from(explicit);
        if candidate.exists() || explicit != DEFAULT_STATIC_DIR {
            return candidate;
        }
    }
    let default_path = Path::new(DEFAULT_STATIC_DIR);
    if default_path.exists() {
        return default_path.to_path_buf();
    }
    PathBuf::from(FALLBACK_STATIC_DIR)
}

fn resolve_basic_auth() -> Result<Option<BasicAuthCredentials>, AppError> {
    let user = non_empty_env("CHARTS_BASIC_AUTH_USER");
    let pass_env = non_empty_env("CHARTS_BASIC_AUTH_PASS");
    let pass_file = non_empty_env("CHARTS_BASIC_AUTH_PASS_FILE");

    let password = match (pass_env, pass_file) {
        (Some(pass), _) => Some(pass),
        (None, Some(file_path)) => {
            let raw = std::fs::read_to_string(&file_path).map_err(|err| {
                AppError::Config(format!(
                    "failed to read CHARTS_BASIC_AUTH_PASS_FILE '{file_path}': {err}"
                ))
            })?;
            let trimmed = raw.trim_end_matches(['\r', '\n']).to_owned();
            if trimmed.is_empty() {
                return Err(AppError::Config(format!(
                    "CHARTS_BASIC_AUTH_PASS_FILE '{file_path}' is empty"
                )));
            }
            Some(trimmed)
        }
        (None, None) => None,
    };

    match (user, password) {
        (Some(u), Some(p)) => Ok(Some(BasicAuthCredentials::new(&u, &p))),
        (None, None) => Ok(None),
        (Some(_), None) => Err(AppError::Config(
            "CHARTS_BASIC_AUTH_USER is set without CHARTS_BASIC_AUTH_PASS or CHARTS_BASIC_AUTH_PASS_FILE".to_owned(),
        )),
        (None, Some(_)) => Err(AppError::Config(
            "CHARTS_BASIC_AUTH_PASS is set without CHARTS_BASIC_AUTH_USER".to_owned(),
        )),
    }
}

fn non_empty_env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|v| v.trim().to_owned())
        .filter(|v| !v.is_empty())
}
