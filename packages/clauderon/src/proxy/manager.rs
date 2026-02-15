//! Proxy manager - orchestrates all proxy services.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::RwLock;
use tokio::task::JoinHandle;
use uuid::Uuid;

use super::audit::AuditLogger;
use super::ca::ProxyCa;
use super::config::{Credentials, ProxyConfig};
use super::http_proxy::HttpAuthProxy;
use super::kubectl_proxy::KubectlProxy;
use super::port_allocator::PortAllocator;
use super::talos_gateway::TalosGateway;
use super::{generate_codex_config, generate_container_configs, generate_plugin_config};
use crate::core::session::AccessMode;
use crate::plugins::PluginDiscovery;

/// Manages all proxy services.
#[expect(
    missing_debug_implementations,
    reason = "contains many non-Debug fields (JoinHandle, RwLock)"
)]
pub struct ProxyManager {
    /// Configuration.
    config: ProxyConfig,
    /// Credentials.
    credentials: Arc<Credentials>,
    /// Proxy CA.
    ca: ProxyCa,
    /// Talos gateway.
    talos_gateway: TalosGateway,
    /// kubectl proxy.
    kubectl_proxy: KubectlProxy,
    /// Audit logger.
    audit_logger: Arc<AuditLogger>,
    /// Clauderon directory.
    clauderon_dir: PathBuf,
    /// Talos gateway task handle.
    talos_task: Option<JoinHandle<()>>,
    /// Port allocator for session proxies.
    port_allocator: Arc<PortAllocator>,
    /// Per-session HTTP proxy tasks.
    session_proxies: RwLock<HashMap<Uuid, SessionProxyHandle>>,
}

/// Handle to a session-specific proxy
struct SessionProxyHandle {
    port: u16,
    access_mode: Arc<RwLock<AccessMode>>,
    task: JoinHandle<()>,
}

impl ProxyManager {
    /// Create a new proxy manager.
    pub fn new(
        config: ProxyConfig,
        port_allocator_start_port: Option<u16>,
    ) -> anyhow::Result<Self> {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
        let clauderon_dir = home.join(".clauderon");
        std::fs::create_dir_all(&clauderon_dir)?;

        // Load or generate CA
        let ca = ProxyCa::load_or_generate(&clauderon_dir)?;

        // Load credentials
        let credentials = Arc::new(Credentials::load(&config));

        // Create audit logger
        let audit_logger = if config.audit_enabled {
            Arc::new(AuditLogger::new(config.audit_log_path.clone())?)
        } else {
            Arc::new(AuditLogger::noop())
        };

        // Create Talos gateway
        let mut talos_gateway = TalosGateway::new(config.talos_gateway_port, Arc::new(ca.clone()));
        let _ = talos_gateway.load_config(); // Ignore errors, just won't have Talos support

        // Create kubectl proxy
        let kubectl_proxy = KubectlProxy::new(config.kubectl_proxy_port);

        Ok(Self {
            config,
            credentials,
            ca,
            talos_gateway,
            kubectl_proxy,
            audit_logger,
            clauderon_dir,
            talos_task: None,
            port_allocator: Arc::new(PortAllocator::new(port_allocator_start_port)),
            session_proxies: RwLock::new(HashMap::new()),
        })
    }

    /// Generate container configuration files.
    pub fn generate_configs(&self) -> anyhow::Result<()> {
        generate_container_configs(
            &self.clauderon_dir,
            self.config.talos_gateway_port,
            self.config.kubectl_proxy_port,
        )?;
        let account_id = self.credentials.codex_account_id();
        generate_codex_config(&self.clauderon_dir, account_id.as_deref())?;

        // Generate plugin configuration
        let plugin_discovery = PluginDiscovery::new(
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("/tmp"))
                .join(".claude"),
        );
        if let Ok(plugin_manifest) = plugin_discovery.discover_plugins() {
            if let Err(e) = generate_plugin_config(&self.clauderon_dir, &plugin_manifest) {
                tracing::warn!("Failed to generate plugin config: {}", e);
            } else if !plugin_manifest.installed_plugins.is_empty() {
                tracing::info!(
                    "Generated plugin config with {} plugins",
                    plugin_manifest.installed_plugins.len()
                );
            }
        }

        Ok(())
    }

    /// Start all proxy services.
    pub async fn start(&mut self) -> anyhow::Result<()> {
        tracing::info!("Starting proxy services...");

        // Generate container configs
        self.generate_configs()?;

        // Start Talos gateway if configured
        if self.talos_gateway.is_configured() {
            let talos_addr = self.talos_gateway.addr();
            let gateway = self.talos_gateway.clone();
            self.talos_task = Some(tokio::spawn(async move {
                if let Err(e) = gateway.run().await {
                    tracing::error!("Talos gateway error: {}", e);
                }
            }));
            tracing::info!("Talos mTLS gateway started on {}", talos_addr);
        }

        // Start kubectl proxy if available
        if KubectlProxy::is_available() {
            if let Err(e) = self.kubectl_proxy.start() {
                tracing::warn!(
                    "Failed to start kubectl proxy: {} - kubectl commands will not work in containers",
                    e
                );
            } else {
                tracing::info!(
                    "kubectl proxy started on port {}",
                    self.kubectl_proxy.port()
                );
            }
        } else {
            tracing::info!(
                "kubectl not found - skipping kubectl proxy (kubectl commands will not work in containers)"
            );
        }

        tracing::info!("Proxy services started");
        Ok(())
    }

    /// Stop all proxy services.
    pub fn stop(&mut self) -> anyhow::Result<()> {
        tracing::info!("Stopping proxy services...");

        // Stop kubectl proxy
        self.kubectl_proxy.stop();

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
        // No global proxies to check - always healthy
        // Session proxies are managed separately
        true
    }

    /// Get the proxy CA certificate path.
    pub fn ca_cert_path(&self) -> &PathBuf {
        self.ca.cert_path()
    }

    /// Get the clauderon directory.
    pub fn clauderon_dir(&self) -> &PathBuf {
        &self.clauderon_dir
    }

    /// Get the Talos gateway port.
    pub fn talos_gateway_port(&self) -> u16 {
        self.config.talos_gateway_port
    }

    /// Create a session-specific proxy
    pub async fn create_session_proxy(
        &self,
        session_id: Uuid,
        access_mode: AccessMode,
    ) -> anyhow::Result<u16> {
        let port = self.port_allocator.allocate(session_id).await?;
        let access_mode_lock = Arc::new(RwLock::new(access_mode));

        let authority = self.ca.to_rcgen_authority()?;
        let proxy = HttpAuthProxy::for_session(
            port,
            authority,
            Arc::clone(&self.credentials),
            Arc::clone(&self.audit_logger),
            session_id,
            Arc::clone(&access_mode_lock),
        );

        let task = tokio::spawn(async move {
            if let Err(e) = proxy.run().await {
                tracing::error!(session_id = %session_id, "Session proxy error: {}", e);
            }
        });

        // Wait for proxy to bind (health check)
        let mut bound = false;
        for attempt in 1..=10 {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            if tokio::net::TcpStream::connect(format!("127.0.0.1:{port}"))
                .await
                .is_ok()
            {
                tracing::debug!(port = port, "Session proxy ready");
                bound = true;
                break;
            }
            if attempt == 10 {
                tracing::warn!(
                    port = port,
                    session_id = %session_id,
                    "Session proxy may not be ready (could not verify binding)"
                );
            }
        }

        if !bound {
            // Clean up on failure
            task.abort();
            self.port_allocator.release(port).await;
            anyhow::bail!("Session proxy failed to bind on port {port}");
        }

        self.session_proxies.write().await.insert(
            session_id,
            SessionProxyHandle {
                port,
                access_mode: access_mode_lock,
                task,
            },
        );

        tracing::info!(
            session_id = %session_id,
            port = port,
            access_mode = ?access_mode,
            "Created session proxy"
        );

        Ok(port)
    }

    /// Destroy a session-specific proxy
    pub async fn destroy_session_proxy(&self, session_id: Uuid) -> anyhow::Result<()> {
        let mut proxies = self.session_proxies.write().await;
        if let Some(handle) = proxies.remove(&session_id) {
            drop(proxies);
            handle.task.abort();
            self.port_allocator.release(handle.port).await;
            tracing::info!(
                session_id = %session_id,
                port = handle.port,
                "Destroyed session proxy"
            );
        }
        Ok(())
    }

    /// Update the access mode for a session proxy
    pub async fn update_session_access_mode(
        &self,
        session_id: Uuid,
        new_mode: AccessMode,
    ) -> anyhow::Result<()> {
        let proxies = self.session_proxies.read().await;
        if let Some(handle) = proxies.get(&session_id) {
            *handle.access_mode.write().await = new_mode;
            tracing::info!(
                session_id = %session_id,
                mode = ?new_mode,
                "Updated session access mode"
            );
            Ok(())
        } else {
            anyhow::bail!("Session proxy not found for session {session_id}")
        }
    }

    /// Get reference to credentials (for status checking only).
    pub fn get_credentials(&self) -> &Credentials {
        &self.credentials
    }

    /// Check if Talos gateway is configured.
    pub fn is_talos_configured(&self) -> bool {
        self.talos_gateway.is_configured()
    }

    /// Get the secrets directory path.
    pub fn secrets_dir(&self) -> &PathBuf {
        &self.config.secrets_dir
    }

    /// Reload credentials from disk (after they've been updated).
    ///
    /// This updates the credentials in the ProxyManager, but note that
    /// already-running proxy instances will continue using their existing
    /// credential references. New proxies created after this call will
    /// use the updated credentials.
    pub fn reload_credentials(&mut self) {
        self.credentials = Arc::new(Credentials::load(&self.config));
        tracing::info!("Credentials reloaded from disk");
    }

    /// Count the number of active session proxies.
    pub async fn active_session_proxy_count(&self) -> usize {
        self.session_proxies.read().await.len()
    }

    /// Get reference to port allocator (for restoration)
    ///
    /// Exposed to allow daemon initialization code to restore port allocations
    /// from database on startup.
    pub fn port_allocator(&self) -> &Arc<PortAllocator> {
        &self.port_allocator
    }

    /// Restore session proxies from database
    ///
    /// Called on daemon startup to recreate proxies for active sessions.
    /// Only restores proxies for sessions with Running status.
    ///
    /// This enables containers to maintain network connectivity across daemon restarts
    /// by recreating the proxy listeners on their allocated ports.
    pub async fn restore_session_proxies(
        &self,
        sessions: &[crate::core::Session],
    ) -> anyhow::Result<()> {
        use crate::core::{BackendType, SessionStatus};

        tracing::info!("Restoring session proxies from database...");

        let mut restored = 0;
        let mut skipped = 0;

        for session in sessions {
            // Only restore proxies for active Docker sessions with allocated ports
            if session.backend != BackendType::Docker {
                continue;
            }

            if session.status != SessionStatus::Running {
                tracing::debug!(
                    session_id = %session.id,
                    status = ?session.status,
                    "Skipping proxy restore for non-running session"
                );
                skipped += 1;
                continue;
            }

            let Some(port) = session.proxy_port else {
                tracing::debug!(
                    session_id = %session.id,
                    "Skipping proxy restore for session without allocated port"
                );
                skipped += 1;
                continue;
            };

            // Create session proxy with the same port as before
            let access_mode_lock = Arc::new(RwLock::new(session.access_mode));

            let authority = self.ca.to_rcgen_authority()?;
            let proxy = HttpAuthProxy::for_session(
                port,
                authority,
                Arc::clone(&self.credentials),
                Arc::clone(&self.audit_logger),
                session.id,
                Arc::clone(&access_mode_lock),
            );

            // Spawn proxy task
            let session_id = session.id;
            let task = tokio::spawn(async move {
                if let Err(e) = proxy.run().await {
                    tracing::error!(session_id = %session_id, "Session proxy error: {}", e);
                }
            });

            // Wait for proxy to bind (health check)
            let mut bound = false;
            for attempt in 1..=10 {
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                if tokio::net::TcpStream::connect(format!("127.0.0.1:{port}"))
                    .await
                    .is_ok()
                {
                    bound = true;
                    break;
                }
                if attempt == 10 {
                    tracing::warn!(
                        port = port,
                        session_id = %session.id,
                        "Restored session proxy may not be ready (could not verify binding)"
                    );
                }
            }

            if !bound {
                tracing::error!(
                    session_id = %session.id,
                    port = port,
                    "Failed to restore session proxy - port may be in use"
                );
                task.abort();
                // Release the port to prevent leaking it
                self.port_allocator.release(port).await;
                skipped += 1;
                continue;
            }

            // Store in session_proxies map
            self.session_proxies.write().await.insert(
                session.id,
                SessionProxyHandle {
                    port,
                    access_mode: access_mode_lock,
                    task,
                },
            );

            tracing::info!(
                session_id = %session.id,
                port = port,
                access_mode = ?session.access_mode,
                "Restored session proxy"
            );

            restored += 1;
        }

        tracing::info!(
            restored = restored,
            skipped = skipped,
            "Session proxy restoration complete"
        );

        Ok(())
    }
}

impl Drop for ProxyManager {
    fn drop(&mut self) {
        // Best-effort cleanup of Talos gateway task
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
