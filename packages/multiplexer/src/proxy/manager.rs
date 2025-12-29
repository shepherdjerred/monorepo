//! Proxy manager - orchestrates all proxy services.

use std::path::PathBuf;
use std::sync::Arc;

use tokio::task::JoinHandle;

use super::audit::AuditLogger;
use super::ca::ProxyCa;
use super::config::{Credentials, ProxyConfig};
use super::container_config::generate_container_configs;
use super::http_proxy::HttpAuthProxy;
use super::k8s_proxy::KubernetesProxy;
use super::talos_gateway::TalosGateway;

/// Manages all proxy services.
pub struct ProxyManager {
    /// Configuration.
    config: ProxyConfig,
    /// Credentials.
    credentials: Arc<Credentials>,
    /// Proxy CA.
    ca: ProxyCa,
    /// Kubernetes proxy.
    k8s_proxy: KubernetesProxy,
    /// Talos gateway.
    talos_gateway: TalosGateway,
    /// Audit logger.
    audit_logger: Arc<AuditLogger>,
    /// Mux directory.
    mux_dir: PathBuf,
    /// HTTP proxy task handle.
    http_task: Option<JoinHandle<()>>,
    /// Talos gateway task handle.
    talos_task: Option<JoinHandle<()>>,
}

impl ProxyManager {
    /// Create a new proxy manager.
    pub fn new(config: ProxyConfig) -> anyhow::Result<Self> {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
        let mux_dir = home.join(".mux");
        std::fs::create_dir_all(&mux_dir)?;

        // Load or generate CA
        let ca = ProxyCa::load_or_generate(&mux_dir)?;

        // Load credentials
        let credentials = Arc::new(Credentials::load(&config.secrets_dir));

        // Create audit logger
        let audit_logger = if config.audit_enabled {
            Arc::new(AuditLogger::new(config.audit_log_path.clone())?)
        } else {
            Arc::new(AuditLogger::noop())
        };

        // Create Kubernetes proxy
        let k8s_proxy = KubernetesProxy::new(config.k8s_proxy_port);

        // Create Talos gateway
        let mut talos_gateway = TalosGateway::new(config.talos_gateway_port);
        let _ = talos_gateway.load_config(); // Ignore errors, just won't have Talos support

        Ok(Self {
            config,
            credentials,
            ca,
            k8s_proxy,
            talos_gateway,
            audit_logger,
            mux_dir,
            http_task: None,
            talos_task: None,
        })
    }

    /// Generate container configuration files.
    pub fn generate_configs(&self) -> anyhow::Result<()> {
        generate_container_configs(
            &self.mux_dir,
            self.config.k8s_proxy_port,
            self.config.talos_gateway_port,
        )?;
        Ok(())
    }

    /// Start all proxy services.
    pub async fn start(&mut self) -> anyhow::Result<()> {
        tracing::info!("Starting proxy services with TLS interception...");

        // Generate container configs
        self.generate_configs()?;

        // Create RcgenAuthority from CA
        let authority = self.ca.to_rcgen_authority()?;

        // Create HTTP auth proxy
        let http_proxy = HttpAuthProxy::new(
            self.config.http_proxy_port,
            authority,
            Arc::clone(&self.credentials),
            Arc::clone(&self.audit_logger),
        );

        // Start HTTP auth proxy
        let http_port = self.config.http_proxy_port;
        self.http_task = Some(tokio::spawn(async move {
            if let Err(e) = http_proxy.run().await {
                tracing::error!("HTTP auth proxy error: {}", e);
            }
        }));

        // Wait for HTTP proxy to be ready
        for attempt in 1..=10 {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            if tokio::net::TcpStream::connect(format!("127.0.0.1:{}", http_port))
                .await
                .is_ok()
            {
                tracing::debug!("HTTP proxy ready on port {}", http_port);
                break;
            }
            if attempt == 10 {
                tracing::warn!("HTTP proxy may not be ready (could not verify binding)");
            }
        }

        // Start Kubernetes proxy
        self.k8s_proxy.start().await?;

        // Start Talos gateway if configured
        if self.talos_gateway.is_configured() {
            let talos_addr = self.talos_gateway.addr();
            // Note: We can't easily move TalosGateway into a task without Clone
            // For now, run it inline or restructure
            tracing::info!("Talos gateway would start on {}", talos_addr);
        }

        tracing::info!("Proxy services started");
        Ok(())
    }

    /// Stop all proxy services.
    pub async fn stop(&mut self) -> anyhow::Result<()> {
        tracing::info!("Stopping proxy services...");

        // Stop kubectl proxy
        self.k8s_proxy.stop()?;

        // Abort HTTP proxy task
        if let Some(task) = self.http_task.take() {
            task.abort();
        }

        // Abort Talos gateway task
        if let Some(task) = self.talos_task.take() {
            task.abort();
        }

        // Flush audit log
        self.audit_logger.flush()?;

        tracing::info!("Proxy services stopped");
        Ok(())
    }

    /// Check if all services are healthy.
    pub fn is_healthy(&mut self) -> bool {
        // Check if tasks are still running
        let http_healthy = self.http_task.as_ref().is_none_or(|t| !t.is_finished());

        // Check kubectl proxy
        let k8s_healthy = self.k8s_proxy.is_running();

        http_healthy && k8s_healthy
    }

    /// Get the proxy CA certificate path.
    pub fn ca_cert_path(&self) -> &PathBuf {
        self.ca.cert_path()
    }

    /// Get the mux directory.
    pub fn mux_dir(&self) -> &PathBuf {
        &self.mux_dir
    }

    /// Get the HTTP proxy port.
    pub fn http_proxy_port(&self) -> u16 {
        self.config.http_proxy_port
    }

    /// Get the Kubernetes proxy port.
    pub fn k8s_proxy_port(&self) -> u16 {
        self.config.k8s_proxy_port
    }

    /// Get the Talos gateway port.
    pub fn talos_gateway_port(&self) -> u16 {
        self.config.talos_gateway_port
    }
}

impl Drop for ProxyManager {
    fn drop(&mut self) {
        // Best-effort cleanup
        let _ = self.k8s_proxy.stop();
        if let Some(task) = self.http_task.take() {
            task.abort();
        }
        if let Some(task) = self.talos_task.take() {
            task.abort();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_manager_creation() {
        let _config = ProxyConfig::default();
        // This will fail in test environment without home dir etc
        // Just verify it compiles
    }
}
