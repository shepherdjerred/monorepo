//! Helpers for Codex auth handling (dummy tokens, auth.json scaffolding).

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD as BASE64_URL};
use chrono::Utc;
use serde_json::json;

pub const DUMMY_ACCESS_TOKEN: &str = "clauderon-codex-proxy-access-token";
pub const DUMMY_REFRESH_TOKEN: &str = "clauderon-codex-proxy-refresh-token";
pub const DUMMY_ACCOUNT_ID: &str = "clauderon-codex-proxy-account";

pub fn dummy_id_token(account_id: Option<&str>) -> String {
    let header = json!({ "alg": "none", "typ": "JWT" });
    let payload = json!({
        "email": "user@example.com",
        "https://api.openai.com/auth": {
            "chatgpt_plan_type": "pro",
            "chatgpt_account_id": account_id.unwrap_or(DUMMY_ACCOUNT_ID),
        }
    });

    let header_b64 = BASE64_URL.encode(serde_json::to_vec(&header).unwrap_or_default());
    let payload_b64 = BASE64_URL.encode(serde_json::to_vec(&payload).unwrap_or_default());
    let signature_b64 = BASE64_URL.encode(b"sig");

    format!("{header_b64}.{payload_b64}.{signature_b64}")
}

pub fn dummy_auth_json_string(account_id: Option<&str>) -> anyhow::Result<String> {
    let auth_json = json!({
        "OPENAI_API_KEY": null,
        "tokens": {
            "id_token": dummy_id_token(account_id),
            "access_token": DUMMY_ACCESS_TOKEN,
            "refresh_token": DUMMY_REFRESH_TOKEN,
            "account_id": account_id.unwrap_or(DUMMY_ACCOUNT_ID),
        },
        "last_refresh": Utc::now(),
    });

    Ok(serde_json::to_string_pretty(&auth_json)?)
}

pub fn dummy_config_toml() -> &'static str {
    "cli_auth_credentials_store = \"file\"\n"
}
