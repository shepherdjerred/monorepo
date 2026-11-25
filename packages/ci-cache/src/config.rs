use std::env;
use std::net::IpAddr;
use std::path::PathBuf;

pub const DEFAULT_PORT: u16 = 7380;
pub const DEFAULT_DATA_DIR: &str = "/var/cache/ci-cache";
pub const DEFAULT_WRITE_USER: &str = "ci-main";
pub const DEFAULT_READ_USER: &str = "ci-pull-request";

pub const GIB: u64 = 1024 * 1024 * 1024;
pub const MIB: u64 = 1024 * 1024;

pub const DEFAULT_QUOTA_BYTES: u64 = 1024 * GIB;
pub const DEFAULT_HIGH_WATERMARK_BYTES: u64 = 850 * GIB;
pub const DEFAULT_LOW_WATERMARK_BYTES: u64 = 780 * GIB;

pub const DEFAULT_TURBO_TTL_SECS: u64 = 14 * 86_400;
pub const DEFAULT_SCCACHE_PR_TTL_SECS: u64 = 14 * 86_400;
pub const DEFAULT_GRADLE_TTL_SECS: u64 = 30 * 86_400;
pub const DEFAULT_SCCACHE_TRUSTED_TTL_SECS: u64 = 30 * 86_400;

pub const TURBO_MAX_BODY_BYTES: u64 = 512 * MIB;
pub const GRADLE_MAX_BODY_BYTES: u64 = 100 * MIB;
pub const SCCACHE_MAX_BODY_BYTES: u64 = 128 * MIB;

pub const DEFAULT_FLUSH_INTERVAL_SECS: u64 = 30;
pub const DEFAULT_EVICT_INTERVAL_SECS: u64 = 600;

#[derive(Debug, Clone)]
pub struct Config {
    pub host: IpAddr,
    pub port: u16,
    pub data_dir: PathBuf,
    pub static_dir: PathBuf,
    pub turbo_token: Option<String>,
    pub gradle_write_user: String,
    pub gradle_write_password: Option<String>,
    pub gradle_read_user: String,
    pub gradle_read_password: Option<String>,
    pub sccache_write_user: String,
    pub sccache_write_password: Option<String>,
    pub sccache_read_user: String,
    pub sccache_read_password: Option<String>,
    pub quota_bytes: u64,
    pub high_watermark_bytes: u64,
    pub low_watermark_bytes: u64,
    pub turbo_ttl_secs: u64,
    pub gradle_ttl_secs: u64,
    pub sccache_trusted_ttl_secs: u64,
    pub sccache_pr_ttl_secs: u64,
    pub turbo_max_body_bytes: u64,
    pub gradle_max_body_bytes: u64,
    pub sccache_max_body_bytes: u64,
    pub flush_interval_secs: u64,
    pub evict_interval_secs: u64,
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("invalid HOST '{value}': {source}")]
    InvalidHost {
        value: String,
        source: std::net::AddrParseError,
    },
    #[error("invalid integer in {name}='{value}': {source}")]
    InvalidInt {
        name: &'static str,
        value: String,
        source: std::num::ParseIntError,
    },
    #[error(
        "CI_CACHE_LOW_WATERMARK_BYTES ({low}) must not exceed CI_CACHE_HIGH_WATERMARK_BYTES ({high})"
    )]
    InvalidWatermarks { low: u64, high: u64 },
}

fn non_empty_env(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|val| val.trim().to_owned())
        .filter(|val| !val.is_empty())
}

fn parse_u64_env(name: &'static str, default: u64) -> Result<u64, ConfigError> {
    match non_empty_env(name) {
        None => Ok(default),
        Some(value) => value
            .parse::<u64>()
            .map_err(|source| ConfigError::InvalidInt {
                name,
                value,
                source,
            }),
    }
}

fn parse_u16_env(name: &'static str, default: u16) -> Result<u16, ConfigError> {
    match non_empty_env(name) {
        None => Ok(default),
        Some(value) => value
            .parse::<u16>()
            .map_err(|source| ConfigError::InvalidInt {
                name,
                value,
                source,
            }),
    }
}

fn resolve_default_static_dir() -> PathBuf {
    if let Some(explicit) = non_empty_env("CI_CACHE_STATIC_DIR") {
        return PathBuf::from(explicit);
    }
    let local = PathBuf::from("dist/client");
    if local.exists() {
        return local;
    }
    let package_rel = PathBuf::from("packages/ci-cache/dist/client");
    if package_rel.exists() {
        return package_rel;
    }
    let usr_share = PathBuf::from("/usr/share/ci-cache/client");
    if usr_share.exists() {
        return usr_share;
    }
    local
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        let host_raw = non_empty_env("HOST").unwrap_or_else(|| "0.0.0.0".to_owned());
        let host = host_raw
            .parse::<IpAddr>()
            .map_err(|source| ConfigError::InvalidHost {
                value: host_raw,
                source,
            })?;
        let port = parse_u16_env("PORT", DEFAULT_PORT)?;
        let data_dir = non_empty_env("CI_CACHE_DATA_DIR")
            .map_or_else(|| PathBuf::from(DEFAULT_DATA_DIR), PathBuf::from);
        let static_dir = resolve_default_static_dir();

        let gradle_write_user = non_empty_env("GRADLE_CACHE_WRITE_USER")
            .unwrap_or_else(|| DEFAULT_WRITE_USER.to_owned());
        let gradle_write_password = non_empty_env("GRADLE_BUILD_CACHE_WRITE_PASSWORD");
        let gradle_read_user =
            non_empty_env("GRADLE_CACHE_READ_USER").unwrap_or_else(|| DEFAULT_READ_USER.to_owned());
        let gradle_read_password = non_empty_env("GRADLE_BUILD_CACHE_READ_PASSWORD");

        let sccache_write_user =
            non_empty_env("SCCACHE_WRITE_USER").unwrap_or_else(|| gradle_write_user.clone());
        let sccache_write_password =
            non_empty_env("SCCACHE_WRITE_PASSWORD").or_else(|| gradle_write_password.clone());
        let sccache_read_user =
            non_empty_env("SCCACHE_READ_USER").unwrap_or_else(|| gradle_read_user.clone());
        let sccache_read_password =
            non_empty_env("SCCACHE_READ_PASSWORD").or_else(|| gradle_read_password.clone());

        let quota_bytes = parse_u64_env("CI_CACHE_QUOTA_BYTES", DEFAULT_QUOTA_BYTES)?;
        let high_watermark_bytes = parse_u64_env(
            "CI_CACHE_HIGH_WATERMARK_BYTES",
            DEFAULT_HIGH_WATERMARK_BYTES,
        )?;
        let low_watermark_bytes =
            parse_u64_env("CI_CACHE_LOW_WATERMARK_BYTES", DEFAULT_LOW_WATERMARK_BYTES)?;
        if low_watermark_bytes > high_watermark_bytes {
            return Err(ConfigError::InvalidWatermarks {
                low: low_watermark_bytes,
                high: high_watermark_bytes,
            });
        }

        Ok(Self {
            host,
            port,
            data_dir,
            static_dir,
            turbo_token: non_empty_env("TURBO_TOKEN"),
            gradle_write_user,
            gradle_write_password,
            gradle_read_user,
            gradle_read_password,
            sccache_write_user,
            sccache_write_password,
            sccache_read_user,
            sccache_read_password,
            quota_bytes,
            high_watermark_bytes,
            low_watermark_bytes,
            turbo_ttl_secs: parse_u64_env("CI_CACHE_TURBO_TTL_SECS", DEFAULT_TURBO_TTL_SECS)?,
            gradle_ttl_secs: parse_u64_env("CI_CACHE_GRADLE_TTL_SECS", DEFAULT_GRADLE_TTL_SECS)?,
            sccache_trusted_ttl_secs: parse_u64_env(
                "CI_CACHE_SCCACHE_TRUSTED_TTL_SECS",
                DEFAULT_SCCACHE_TRUSTED_TTL_SECS,
            )?,
            sccache_pr_ttl_secs: parse_u64_env(
                "CI_CACHE_SCCACHE_PR_TTL_SECS",
                DEFAULT_SCCACHE_PR_TTL_SECS,
            )?,
            turbo_max_body_bytes: parse_u64_env(
                "CI_CACHE_TURBO_MAX_BODY_BYTES",
                TURBO_MAX_BODY_BYTES,
            )?,
            gradle_max_body_bytes: parse_u64_env(
                "CI_CACHE_GRADLE_MAX_BODY_BYTES",
                GRADLE_MAX_BODY_BYTES,
            )?,
            sccache_max_body_bytes: parse_u64_env(
                "CI_CACHE_SCCACHE_MAX_BODY_BYTES",
                SCCACHE_MAX_BODY_BYTES,
            )?,
            flush_interval_secs: parse_u64_env(
                "CI_CACHE_FLUSH_INTERVAL_SECS",
                DEFAULT_FLUSH_INTERVAL_SECS,
            )?,
            evict_interval_secs: parse_u64_env(
                "CI_CACHE_EVICT_INTERVAL_SECS",
                DEFAULT_EVICT_INTERVAL_SECS,
            )?,
        })
    }

    pub fn ttl_for_namespace(&self, namespace: &str) -> u64 {
        if namespace.starts_with("turbo:") {
            self.turbo_ttl_secs
        } else if namespace == "gradle:main" {
            self.gradle_ttl_secs
        } else if namespace == "sccache:trusted" {
            self.sccache_trusted_ttl_secs
        } else if namespace == "sccache:pr" {
            self.sccache_pr_ttl_secs
        } else {
            self.turbo_ttl_secs
        }
    }
}
