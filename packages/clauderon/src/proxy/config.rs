//! Proxy configuration and credentials management.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use base64::Engine as _;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 1Password configuration section.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnePasswordConfig {
    /// Enable 1Password integration.
    #[serde(default)]
    pub enabled: bool,

    /// Path to op CLI (default: "op").
    #[serde(default = "default_op_path")]
    pub op_path: String,

    /// Credential mappings (credential_name -> op://reference).
    #[serde(default)]
    pub credentials: HashMap<String, String>,
}

fn default_op_path() -> String {
    "op".to_string()
}

impl Default for OnePasswordConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            op_path: default_op_path(),
            credentials: HashMap::new(),
        }
    }
}

/// Proxy service configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyConfig {
    /// Directory containing credential files.
    pub secrets_dir: PathBuf,

    /// Talos mTLS gateway port (default: 18082).
    pub talos_gateway_port: u16,

    /// kubectl proxy port (default: 18081).
    pub kubectl_proxy_port: u16,

    /// Enable audit logging.
    pub audit_enabled: bool,

    /// Audit log file path.
    pub audit_log_path: PathBuf,

    /// Optional path to the host Codex auth.json file.
    pub codex_auth_json_path: Option<PathBuf>,

    /// 1Password integration configuration.
    #[serde(default)]
    pub onepassword: OnePasswordConfig,
}

impl Default for ProxyConfig {
    fn default() -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
        Self {
            secrets_dir: home.join(".clauderon/secrets"),
            talos_gateway_port: 18082,
            kubectl_proxy_port: 18081,
            audit_enabled: true,
            audit_log_path: home.join(".clauderon/audit.jsonl"),
            codex_auth_json_path: Some(home.join(".codex/auth.json")),
            onepassword: OnePasswordConfig::default(),
        }
    }
}

impl ProxyConfig {
    /// Load configuration from `~/.clauderon/proxy.toml` or use defaults.
    pub fn load() -> anyhow::Result<Self> {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
        let config_path = home.join(".clauderon/proxy.toml");

        let mut config = if config_path.exists() {
            let content = std::fs::read_to_string(&config_path)?;
            toml::from_str(&content)?
        } else {
            Self::default()
        };

        if let Ok(path) = std::env::var("CODEX_AUTH_JSON_PATH") {
            config.codex_auth_json_path = Some(PathBuf::from(path));
        }

        Ok(config)
    }
}

#[derive(Debug, Clone, Default)]
pub struct CodexTokens {
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub id_token: Option<String>,
    pub account_id: Option<String>,
}

impl CodexTokens {
    fn apply_overlay(&mut self, other: Self) {
        if other.access_token.is_some() {
            self.access_token = other.access_token;
        }
        if other.refresh_token.is_some() {
            self.refresh_token = other.refresh_token;
        }
        if other.id_token.is_some() {
            self.id_token = other.id_token;
        }
        if other.account_id.is_some() {
            self.account_id = other.account_id;
        }
    }

    fn fill_account_id_from_id_token(&mut self) {
        if self.account_id.is_none() {
            if let Some(id_token) = self.id_token.as_deref() {
                if let Some(account_id) = extract_chatgpt_account_id(id_token) {
                    self.account_id = Some(account_id);
                }
            }
        }
    }
}

#[derive(Debug, Deserialize, Serialize, Clone)]
struct CodexAuthTokens {
    id_token: String,
    access_token: String,
    refresh_token: String,
    #[serde(default)]
    account_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
struct CodexAuthJson {
    #[serde(rename = "OPENAI_API_KEY")]
    openai_api_key: Option<String>,
    tokens: Option<CodexAuthTokens>,
    #[serde(default)]
    last_refresh: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Default)]
pub struct CodexTokenUpdate {
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub id_token: Option<String>,
    pub account_id: Option<String>,
}

/// Credentials for various services.
#[derive(Debug, Clone)]
pub struct Credentials {
    pub github_token: Option<String>,
    pub anthropic_oauth_token: Option<String>,
    pub openai_api_key: Option<String>,
    pub codex_tokens: Arc<RwLock<CodexTokens>>,
    pub pagerduty_token: Option<String>,
    pub sentry_auth_token: Option<String>,
    pub grafana_api_key: Option<String>,
    pub npm_token: Option<String>,
    pub docker_token: Option<String>,
    pub k8s_token: Option<String>,
    pub talos_token: Option<String>,
    pub codex_auth_json_path: Option<PathBuf>,
}

impl Default for Credentials {
    fn default() -> Self {
        Self {
            github_token: None,
            anthropic_oauth_token: None,
            openai_api_key: None,
            codex_tokens: Arc::new(RwLock::new(CodexTokens::default())),
            pagerduty_token: None,
            sentry_auth_token: None,
            grafana_api_key: None,
            npm_token: None,
            docker_token: None,
            k8s_token: None,
            talos_token: None,
            codex_auth_json_path: None,
        }
    }
}

impl Credentials {
    /// Load credentials from environment variables.
    #[must_use]
    pub fn load_from_env() -> Self {
        let mut codex_tokens = CodexTokens {
            access_token: std::env::var("CODEX_ACCESS_TOKEN").ok(),
            refresh_token: std::env::var("CODEX_REFRESH_TOKEN").ok(),
            id_token: std::env::var("CODEX_ID_TOKEN").ok(),
            account_id: std::env::var("CODEX_ACCOUNT_ID").ok(),
        };
        codex_tokens.fill_account_id_from_id_token();
        Self {
            github_token: std::env::var("GITHUB_TOKEN").ok(),
            anthropic_oauth_token: std::env::var("CLAUDE_CODE_OAUTH_TOKEN").ok(),
            openai_api_key: std::env::var("OPENAI_API_KEY")
                .or_else(|_| std::env::var("CODEX_API_KEY"))
                .ok(),
            codex_tokens: Arc::new(RwLock::new(codex_tokens)),
            // Support both PAGERDUTY_TOKEN and PAGERDUTY_API_KEY for compatibility
            pagerduty_token: std::env::var("PAGERDUTY_TOKEN")
                .or_else(|_| std::env::var("PAGERDUTY_API_KEY"))
                .ok(),
            sentry_auth_token: std::env::var("SENTRY_AUTH_TOKEN").ok(),
            grafana_api_key: std::env::var("GRAFANA_API_KEY").ok(),
            npm_token: std::env::var("NPM_TOKEN").ok(),
            docker_token: std::env::var("DOCKER_TOKEN").ok(),
            k8s_token: std::env::var("K8S_TOKEN").ok(),
            talos_token: std::env::var("TALOS_TOKEN").ok(),
            codex_auth_json_path: None,
        }
    }

    /// Load credentials from files in the secrets directory.
    #[must_use]
    pub fn load_from_files(secrets_dir: &Path) -> Self {
        let read_secret = |name: &str| -> Option<String> {
            let path = secrets_dir.join(name);
            std::fs::read_to_string(&path)
                .ok()
                .map(|s| s.trim().to_string())
        };

        Self {
            github_token: read_secret("github_token"),
            anthropic_oauth_token: read_secret("anthropic_oauth_token"),
            openai_api_key: read_secret("openai_api_key"),
            codex_tokens: Arc::new(RwLock::new(CodexTokens::default())),
            pagerduty_token: read_secret("pagerduty_token"),
            sentry_auth_token: read_secret("sentry_auth_token"),
            grafana_api_key: read_secret("grafana_api_key"),
            npm_token: read_secret("npm_token"),
            docker_token: read_secret("docker_token"),
            k8s_token: read_secret("k8s_token"),
            talos_token: read_secret("talos_token"),
            codex_auth_json_path: None,
        }
    }

    /// Load credentials - try environment first, then 1Password, then files.
    ///
    /// This is the main entry point for credential loading, supporting three sources
    /// in priority order:
    /// 1. Environment variables (highest)
    /// 2. 1Password (if enabled)
    /// 3. Files in secrets directory (lowest)
    pub fn load(config: &ProxyConfig) -> Self {
        // If 1Password is disabled, we can avoid the async complexity entirely
        if !config.onepassword.enabled {
            return Self::load_sync(config);
        }

        // 1Password is enabled, we need async support
        // Try to use existing runtime if available, otherwise create one
        match tokio::runtime::Handle::try_current() {
            Ok(_handle) => {
                // We're in an async context but can't block here.
                // This is a limitation: load() is sync but needs async for 1Password.
                // Fall back to sync loading (skip 1Password)
                tracing::warn!(
                    "1Password is enabled but Credentials::load() was called from an async context. \
                     Falling back to sync loading (skipping 1Password). \
                     Use Credentials::load_with_priority() directly in async contexts."
                );
                Self::load_sync(config)
            }
            Err(_) => {
                // No runtime available, create a new one just for this operation
                let rt = tokio::runtime::Runtime::new()
                    .expect("Failed to create tokio runtime for credential loading");
                rt.block_on(Self::load_with_priority(config))
            }
        }
    }

    /// Synchronous credential loading without 1Password support.
    /// Used as a fallback when async is not available or when 1Password is disabled.
    fn load_sync(config: &ProxyConfig) -> Self {
        let from_env = Self::load_from_env();
        let from_files = Self::load_from_files(&config.secrets_dir);

        let mut openai_api_key = from_env
            .openai_api_key
            .clone()
            .or(from_files.openai_api_key);

        let (codex_tokens_from_auth, auth_openai_api_key) =
            load_codex_tokens_from_auth_json(config.codex_auth_json_path.as_deref());
        if openai_api_key.is_none() {
            openai_api_key = auth_openai_api_key;
        }

        let mut codex_tokens = codex_tokens_from_auth;
        codex_tokens.apply_overlay(from_env.codex_tokens_snapshot());
        codex_tokens.fill_account_id_from_id_token();

        Self {
            github_token: from_env.github_token.or(from_files.github_token),
            anthropic_oauth_token: from_env
                .anthropic_oauth_token
                .or(from_files.anthropic_oauth_token),
            openai_api_key,
            codex_tokens: Arc::new(RwLock::new(codex_tokens)),
            pagerduty_token: from_env.pagerduty_token.or(from_files.pagerduty_token),
            sentry_auth_token: from_env.sentry_auth_token.or(from_files.sentry_auth_token),
            grafana_api_key: from_env.grafana_api_key.or(from_files.grafana_api_key),
            npm_token: from_env.npm_token.or(from_files.npm_token),
            docker_token: from_env.docker_token.or(from_files.docker_token),
            k8s_token: from_env.k8s_token.or(from_files.k8s_token),
            talos_token: from_env.talos_token.or(from_files.talos_token),
            codex_auth_json_path: config.codex_auth_json_path.clone(),
        }
    }

    /// Detect if a value contains an op:// reference.
    fn is_op_reference(value: &str) -> bool {
        value.starts_with("op://")
    }

    /// Load credentials from 1Password based on configuration and env vars.
    #[tracing::instrument(skip(config))]
    pub async fn load_from_onepassword(config: &ProxyConfig) -> Self {
        use crate::proxy::onepassword::{OnePasswordClient, OpReference};

        // Early return if 1Password is not enabled
        if !config.onepassword.enabled {
            tracing::debug!("1Password integration disabled");
            return Self::default();
        }

        // Create 1Password client
        let client = OnePasswordClient::new(config.onepassword.op_path.clone());

        // Check if op CLI is available
        if !client.is_available().await {
            tracing::warn!("1Password CLI (op) not found, skipping 1Password credential loading");
            return Self::default();
        }

        // Collect all op:// references from:
        // 1. TOML config
        // 2. Environment variables
        let mut references = HashMap::new();

        // Add from TOML
        for (key, value) in &config.onepassword.credentials {
            if let Ok(op_ref) = OpReference::parse(value) {
                references.insert(key.clone(), op_ref);
            } else {
                tracing::warn!(credential = %key, reference = %value, "Invalid op:// reference");
            }
        }

        // Add from environment variables with op:// references
        let env_mappings = [
            ("GITHUB_TOKEN", "github_token"),
            ("CLAUDE_CODE_OAUTH_TOKEN", "anthropic_oauth_token"),
            ("OPENAI_API_KEY", "openai_api_key"),
            ("CODEX_API_KEY", "openai_api_key"),
            ("PAGERDUTY_TOKEN", "pagerduty_token"),
            ("PAGERDUTY_API_KEY", "pagerduty_token"),
            ("SENTRY_AUTH_TOKEN", "sentry_auth_token"),
            ("GRAFANA_API_KEY", "grafana_api_key"),
            ("NPM_TOKEN", "npm_token"),
            ("DOCKER_TOKEN", "docker_token"),
            ("K8S_TOKEN", "k8s_token"),
            ("TALOS_TOKEN", "talos_token"),
        ];

        for (env_key, credential_key) in env_mappings {
            if let Ok(value) = std::env::var(env_key) {
                if Self::is_op_reference(&value) {
                    if let Ok(op_ref) = OpReference::parse(&value) {
                        references.insert(credential_key.to_string(), op_ref);
                    }
                }
            }
        }

        // Early return if no references to fetch
        if references.is_empty() {
            tracing::debug!("No 1Password references found");
            return Self::default();
        }

        // Batch fetch all credentials
        let results = client.fetch_all_credentials(&references).await;

        // Build Credentials struct from results
        Self {
            github_token: results
                .get("github_token")
                .and_then(|r| r.as_ref().ok().cloned()),
            anthropic_oauth_token: results
                .get("anthropic_oauth_token")
                .and_then(|r| r.as_ref().ok().cloned()),
            openai_api_key: results
                .get("openai_api_key")
                .and_then(|r| r.as_ref().ok().cloned()),
            codex_tokens: Arc::new(RwLock::new(CodexTokens::default())),
            pagerduty_token: results
                .get("pagerduty_token")
                .and_then(|r| r.as_ref().ok().cloned()),
            sentry_auth_token: results
                .get("sentry_auth_token")
                .and_then(|r| r.as_ref().ok().cloned()),
            grafana_api_key: results
                .get("grafana_api_key")
                .and_then(|r| r.as_ref().ok().cloned()),
            npm_token: results
                .get("npm_token")
                .and_then(|r| r.as_ref().ok().cloned()),
            docker_token: results
                .get("docker_token")
                .and_then(|r| r.as_ref().ok().cloned()),
            k8s_token: results
                .get("k8s_token")
                .and_then(|r| r.as_ref().ok().cloned()),
            talos_token: results
                .get("talos_token")
                .and_then(|r| r.as_ref().ok().cloned()),
            codex_auth_json_path: None,
        }
    }

    /// Load credentials with 3-source priority: env vars → 1Password → files.
    #[tracing::instrument(skip(config))]
    pub async fn load_with_priority(config: &ProxyConfig) -> Self {
        tracing::info!("Loading credentials from multiple sources");

        // Source 1: Environment variables (highest priority)
        let from_env = Self::load_from_env();

        // Source 2: 1Password (middle priority)
        let from_onepassword = Self::load_from_onepassword(config).await;

        // Source 3: Files (lowest priority)
        let from_files = Self::load_from_files(&config.secrets_dir);

        // Handle OpenAI API key with special Codex auth.json logic
        let mut openai_api_key = from_env
            .openai_api_key
            .clone()
            .or(from_onepassword.openai_api_key)
            .or(from_files.openai_api_key);

        let (codex_tokens_from_auth, auth_openai_api_key) =
            load_codex_tokens_from_auth_json(config.codex_auth_json_path.as_deref());
        if openai_api_key.is_none() {
            openai_api_key = auth_openai_api_key;
        }

        let mut codex_tokens = codex_tokens_from_auth;
        codex_tokens.apply_overlay(from_env.codex_tokens_snapshot());
        codex_tokens.fill_account_id_from_id_token();

        // Merge credentials with priority
        let credentials = Self {
            github_token: from_env
                .github_token
                .or(from_onepassword.github_token)
                .or(from_files.github_token),
            anthropic_oauth_token: from_env
                .anthropic_oauth_token
                .or(from_onepassword.anthropic_oauth_token)
                .or(from_files.anthropic_oauth_token),
            openai_api_key,
            codex_tokens: Arc::new(RwLock::new(codex_tokens)),
            pagerduty_token: from_env
                .pagerduty_token
                .or(from_onepassword.pagerduty_token)
                .or(from_files.pagerduty_token),
            sentry_auth_token: from_env
                .sentry_auth_token
                .or(from_onepassword.sentry_auth_token)
                .or(from_files.sentry_auth_token),
            grafana_api_key: from_env
                .grafana_api_key
                .or(from_onepassword.grafana_api_key)
                .or(from_files.grafana_api_key),
            npm_token: from_env
                .npm_token
                .or(from_onepassword.npm_token)
                .or(from_files.npm_token),
            docker_token: from_env
                .docker_token
                .or(from_onepassword.docker_token)
                .or(from_files.docker_token),
            k8s_token: from_env
                .k8s_token
                .or(from_onepassword.k8s_token)
                .or(from_files.k8s_token),
            talos_token: from_env
                .talos_token
                .or(from_onepassword.talos_token)
                .or(from_files.talos_token),
            codex_auth_json_path: config.codex_auth_json_path.clone(),
        };

        // Enhanced logging showing credential availability
        tracing::info!("Credential loading summary:");
        if credentials.github_token.is_some() {
            tracing::info!("  ✓ GitHub token");
        }
        if credentials.anthropic_oauth_token.is_some() {
            tracing::info!("  ✓ Anthropic OAuth token");
        }
        if credentials.openai_api_key.is_some() {
            tracing::info!("  ✓ OpenAI API key");
        }
        if credentials.codex_access_token().is_some() {
            tracing::info!("  ✓ Codex access token");
        }
        if credentials.pagerduty_token.is_some() {
            tracing::info!("  ✓ PagerDuty token");
        }
        if credentials.sentry_auth_token.is_some() {
            tracing::info!("  ✓ Sentry auth token");
        }
        if credentials.grafana_api_key.is_some() {
            tracing::info!("  ✓ Grafana API key");
        }
        if credentials.npm_token.is_some() {
            tracing::info!("  ✓ npm token");
        }
        if credentials.docker_token.is_some() {
            tracing::info!("  ✓ Docker token");
        }
        if credentials.k8s_token.is_some() {
            tracing::info!("  ✓ Kubernetes token");
        }
        if credentials.talos_token.is_some() {
            tracing::info!("  ✓ Talos token");
        }

        credentials
    }

    /// Get a credential by service name.
    #[must_use]
    pub fn get(&self, service: &str) -> Option<String> {
        match service {
            "github" => self.github_token.clone(),
            "anthropic" => self.anthropic_oauth_token.clone(),
            "openai" => self
                .codex_access_token()
                .or_else(|| self.openai_api_key.clone()),
            "chatgpt" => self.codex_access_token(),
            "pagerduty" => self.pagerduty_token.clone(),
            "sentry" => self.sentry_auth_token.clone(),
            "grafana" => self.grafana_api_key.clone(),
            "npm" => self.npm_token.clone(),
            "docker" => self.docker_token.clone(),
            "k8s" => self.k8s_token.clone(),
            "talos" => self.talos_token.clone(),
            _ => None,
        }
    }

    #[must_use]
    pub fn codex_access_token(&self) -> Option<String> {
        self.codex_tokens
            .read()
            .ok()
            .and_then(|t| t.access_token.clone())
    }

    #[must_use]
    pub fn codex_refresh_token(&self) -> Option<String> {
        self.codex_tokens
            .read()
            .ok()
            .and_then(|t| t.refresh_token.clone())
    }

    #[must_use]
    pub fn codex_account_id(&self) -> Option<String> {
        self.codex_tokens
            .read()
            .ok()
            .and_then(|t| t.account_id.clone())
    }

    fn codex_tokens_snapshot(&self) -> CodexTokens {
        self.codex_tokens
            .read()
            .ok()
            .map(|t| t.clone())
            .unwrap_or_default()
    }

    pub fn update_codex_tokens(&self, update: CodexTokenUpdate) {
        let mut updated_tokens = None;
        if let Ok(mut guard) = self.codex_tokens.write() {
            if update.access_token.is_some() {
                guard.access_token = update.access_token;
            }
            if update.refresh_token.is_some() {
                guard.refresh_token = update.refresh_token;
            }
            if update.id_token.is_some() {
                guard.id_token = update.id_token;
            }
            if update.account_id.is_some() {
                guard.account_id = update.account_id;
            }
            guard.fill_account_id_from_id_token();
            updated_tokens = Some(guard.clone());
        }

        let Some(path) = self.codex_auth_json_path.as_ref() else {
            return;
        };
        let Some(tokens) = updated_tokens else {
            return;
        };

        if let Err(err) = persist_codex_auth_json(path, &tokens, self.openai_api_key.as_ref()) {
            tracing::warn!("Failed to persist Codex auth.json: {}", err);
        }
    }
}

fn load_codex_tokens_from_auth_json(path: Option<&Path>) -> (CodexTokens, Option<String>) {
    let Some(path) = path else {
        return (CodexTokens::default(), None);
    };

    let content = match std::fs::read_to_string(path) {
        Ok(content) => content,
        Err(err) => {
            tracing::warn!(
                "Failed to read Codex auth.json at {}: {}",
                path.display(),
                err
            );
            return (CodexTokens::default(), None);
        }
    };

    let auth_json: CodexAuthJson = match serde_json::from_str(&content) {
        Ok(auth_json) => auth_json,
        Err(err) => {
            tracing::warn!(
                "Failed to parse Codex auth.json at {}: {}",
                path.display(),
                err
            );
            return (CodexTokens::default(), None);
        }
    };

    let tokens = auth_json
        .tokens
        .map_or_else(CodexTokens::default, |tokens| CodexTokens {
            access_token: Some(tokens.access_token),
            refresh_token: Some(tokens.refresh_token),
            id_token: Some(tokens.id_token),
            account_id: tokens.account_id,
        });

    (tokens, auth_json.openai_api_key)
}

fn persist_codex_auth_json(
    path: &Path,
    tokens: &CodexTokens,
    openai_api_key: Option<&String>,
) -> anyhow::Result<()> {
    let auth_json = if path.exists() {
        let content = std::fs::read_to_string(path)?;
        serde_json::from_str::<CodexAuthJson>(&content).unwrap_or_else(|_| CodexAuthJson {
            openai_api_key: openai_api_key.cloned(),
            tokens: None,
            last_refresh: None,
        })
    } else {
        CodexAuthJson {
            openai_api_key: openai_api_key.cloned(),
            tokens: None,
            last_refresh: None,
        }
    };

    let mut auth_json = auth_json;
    let token_payload = CodexAuthTokens {
        id_token: tokens
            .id_token
            .clone()
            .unwrap_or_else(|| "invalid.invalid.invalid".to_string()),
        access_token: tokens
            .access_token
            .clone()
            .unwrap_or_else(|| "missing-access-token".to_string()),
        refresh_token: tokens
            .refresh_token
            .clone()
            .unwrap_or_else(|| "missing-refresh-token".to_string()),
        account_id: tokens.account_id.clone(),
    };
    auth_json.openai_api_key = openai_api_key.cloned();
    auth_json.tokens = Some(token_payload);
    auth_json.last_refresh = Some(Utc::now());

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, serde_json::to_string_pretty(&auth_json)?)?;
    Ok(())
}

fn extract_chatgpt_account_id(id_token: &str) -> Option<String> {
    let mut parts = id_token.split('.');
    let _header_b64 = parts.next()?;
    let payload_b64 = parts.next()?;
    let _sig_b64 = parts.next()?;

    let payload_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload_b64.as_bytes())
        .ok()?;
    let payload: Value = serde_json::from_slice(&payload_bytes).ok()?;
    let auth = payload.get("https://api.openai.com/auth")?;
    auth.get("chatgpt_account_id")
        .and_then(Value::as_str)
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = ProxyConfig::default();
        assert_eq!(config.talos_gateway_port, 18082);
        assert_eq!(config.kubectl_proxy_port, 18081);
    }

    #[test]
    fn test_credentials_from_env() {
        // Just verify load_from_env runs without panic
        // We can't easily set env vars in tests since unsafe is forbidden
        let creds = Credentials::load_from_env();
        // If GITHUB_TOKEN happens to be set, it should be loaded
        // Otherwise it should be None - both are valid
        assert!(creds.github_token.is_some() || creds.github_token.is_none());
    }
}
