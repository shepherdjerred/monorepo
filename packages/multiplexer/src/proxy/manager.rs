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
use super::container_config::generate_container_configs;
use super::http_proxy::HttpAuthProxy;
use super::k8s_proxy::KubernetesProxy;
use super::port_allocator::PortAllocator;
use super::talos_gateway::TalosGateway;
use crate::core::session::AccessMode;

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
        let mut talos_gateway = TalosGateway::new(config.talos_gateway_port, Arc::new(ca.clone()));
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
            port_allocator: Arc::new(PortAllocator::new()),
            session_proxies: RwLock::new(HashMap::new()),
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
            let gateway = self.talos_gateway.clone();
            self.talos_task = Some(tokio::spawn(async move {
                if let Err(e) = gateway.run().await {
                    tracing::error!("Talos gateway error: {}", e);
                }
            }));
            tracing::info!("Talos mTLS gateway started on {}", talos_addr);
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
            if tokio::net::TcpStream::connect(format!("127.0.0.1:{}", port))
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
            anyhow::bail!("Session proxy failed to bind on port {}", port);
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
        if let Some(handle) = self.session_proxies.write().await.remove(&session_id) {
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
            anyhow::bail!("Session proxy not found for session {}", session_id)
        }
    }

    /// Get reference to credentials (for status checking only).
    pub fn get_credentials(&self) -> &Credentials {
        &self.credentials
    }

    /// Check if Kubernetes proxy was started.
    /// Note: This checks if the proxy process exists, not if it's currently alive.
    pub fn is_k8s_proxy_running(&self) -> bool {
        self.k8s_proxy.has_process()
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
        self.credentials = Arc::new(Credentials::load(&self.config.secrets_dir));
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
                if tokio::net::TcpStream::connect(format!("127.0.0.1:{}", port))
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
        // Best-effort cleanup.
        //
        // WARNING: k8s_proxy.stop() performs blocking I/O (child.wait()).
        // In async contexts, call stop() explicitly before dropping to avoid
        // blocking the tokio runtime. This Drop is for safety in non-async
        // contexts or when stop() wasn't called.
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
