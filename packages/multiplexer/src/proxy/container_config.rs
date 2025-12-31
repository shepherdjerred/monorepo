//! Container configuration file generation.
//!
//! Generates kubeconfig and talosconfig files that point to the host proxy,
//! so containers can access Kubernetes and Talos without credentials.

use std::path::PathBuf;

/// Generate all container configuration files.
pub fn generate_container_configs(
    mux_dir: &PathBuf,
    k8s_proxy_port: u16,
    talos_gateway_port: u16,
) -> anyhow::Result<()> {
    generate_kubeconfig(mux_dir, k8s_proxy_port)?;
    generate_talosconfig(mux_dir, talos_gateway_port)?;
    Ok(())
}

/// Generate kubeconfig for containers.
///
/// This kubeconfig points to the kubectl proxy running on the host,
/// so containers don't need any Kubernetes credentials.
fn generate_kubeconfig(mux_dir: &PathBuf, port: u16) -> anyhow::Result<()> {
    let kube_dir = mux_dir.join("kube");
    std::fs::create_dir_all(&kube_dir)?;

    let config = format!(
        r#"apiVersion: v1
kind: Config
clusters:
- cluster:
    server: http://host.docker.internal:{port}
  name: mux-proxied
contexts:
- context:
    cluster: mux-proxied
  name: default
current-context: default
"#
    );

    let config_path = kube_dir.join("config");
    std::fs::write(&config_path, config)?;

    tracing::info!("Generated container kubeconfig at {:?}", config_path);
    Ok(())
}

/// Generate talosconfig for containers.
///
/// This talosconfig points to the Talos TLS gateway running on the host.
/// IMPORTANT: This config intentionally omits ca, crt, and key fields for zero-credential access.
/// The gateway terminates TLS using the proxy's CA, then establishes mTLS to real Talos
/// with the host's credentials. Container never needs private keys.
fn generate_talosconfig(mux_dir: &PathBuf, port: u16) -> anyhow::Result<()> {
    let talos_dir = mux_dir.join("talos");
    std::fs::create_dir_all(&talos_dir)?;

    // Generate minimal talosconfig with NO certificates (zero-credential access)
    // talosctl will use TLS to connect to the gateway at host.docker.internal:port
    // Gateway terminates TLS and re-establishes mTLS to real Talos with host's cert
    let config = format!(
        r#"context: mux-proxied
contexts:
    mux-proxied:
        endpoints:
            - host.docker.internal:{port}
        nodes:
            - host.docker.internal:{port}
"#
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
    fn test_generate_kubeconfig() {
        let dir = tempdir().unwrap();
        let mux_dir = dir.path().to_path_buf();

        generate_kubeconfig(&mux_dir, 18081).unwrap();

        let config_path = mux_dir.join("kube/config");
        assert!(config_path.exists());

        let content = std::fs::read_to_string(&config_path).unwrap();
        assert!(content.contains("host.docker.internal:18081"));
        assert!(content.contains("mux-proxied"));
    }

    #[test]
    fn test_generate_talosconfig() {
        let dir = tempdir().unwrap();
        let mux_dir = dir.path().to_path_buf();

        generate_talosconfig(&mux_dir, 18082).unwrap();

        let config_path = mux_dir.join("talos/config");
        assert!(config_path.exists());

        let content = std::fs::read_to_string(&config_path).unwrap();
        assert!(content.contains("host.docker.internal:18082"));
    }
}
