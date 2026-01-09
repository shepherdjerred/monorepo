//! Container configuration file generation.
//!
//! Generates kubeconfig and talosconfig files that point to the host proxy,
//! so containers can access Kubernetes and Talos without credentials.

use std::path::PathBuf;

use crate::proxy::{dummy_auth_json_string, dummy_config_toml};

/// Generate all container configuration files.
pub fn generate_container_configs(
    clauderon_dir: &PathBuf,
    talos_gateway_port: u16,
) -> anyhow::Result<()> {
    generate_talosconfig(clauderon_dir, talos_gateway_port)?;
    Ok(())
}

/// Generate Codex dummy auth/config files for containers.
pub fn generate_codex_config(
    clauderon_dir: &PathBuf,
    account_id: Option<&str>,
) -> anyhow::Result<()> {
    let codex_dir = clauderon_dir.join("codex");
    std::fs::create_dir_all(&codex_dir)?;

    let auth_json_path = codex_dir.join("auth.json");
    let config_toml_path = codex_dir.join("config.toml");

    std::fs::write(auth_json_path, dummy_auth_json_string(account_id)?)?;
    std::fs::write(config_toml_path, dummy_config_toml())?;
    Ok(())
}

/// Generate talosconfig for containers.
///
/// This talosconfig points to the Talos TLS gateway running on the host.
/// IMPORTANT: This config intentionally omits ca, crt, and key fields for zero-credential access.
/// The gateway terminates TLS using the proxy's CA, then establishes mTLS to real Talos
/// with the host's credentials. Container never needs private keys.
fn generate_talosconfig(clauderon_dir: &PathBuf, port: u16) -> anyhow::Result<()> {
    let talos_dir = clauderon_dir.join("talos");
    std::fs::create_dir_all(&talos_dir)?;

    // Generate minimal talosconfig with NO certificates (zero-credential access)
    // talosctl will use TLS to connect to the gateway at host.docker.internal:port
    // Gateway terminates TLS and re-establishes mTLS to real Talos with host's cert
    let config = format!(
        r"context: clauderon-proxied
contexts:
    clauderon-proxied:
        endpoints:
            - host.docker.internal:{port}
        nodes:
            - host.docker.internal:{port}
"
    );

    let config_path = talos_dir.join("config");
    std::fs::write(&config_path, config)?;

    tracing::info!("Generated container talosconfig at {:?}", config_path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_generate_talosconfig() {
        let dir = tempdir().unwrap();
        let clauderon_dir = dir.path().to_path_buf();

        generate_talosconfig(&clauderon_dir, 18082).unwrap();

        let config_path = clauderon_dir.join("talos/config");
        assert!(config_path.exists());

        let content = std::fs::read_to_string(&config_path).unwrap();
        assert!(content.contains("host.docker.internal:18082"));
    }

    #[test]
    fn test_generate_codex_config() {
        let dir = tempdir().unwrap();
        let clauderon_dir = dir.path().to_path_buf();

        generate_codex_config(&clauderon_dir, Some("acct-123")).unwrap();

        let auth_path = clauderon_dir.join("codex/auth.json");
        let config_path = clauderon_dir.join("codex/config.toml");

        assert!(auth_path.exists());
        assert!(config_path.exists());
    }
}
