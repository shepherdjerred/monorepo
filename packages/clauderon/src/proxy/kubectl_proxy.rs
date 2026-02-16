//! kubectl proxy service for zero-credential Kubernetes API access.
//!
//! This module provides a `KubectlProxy` service that starts `kubectl proxy`
//! on the host, allowing containers to access Kubernetes APIs without credentials.
//! The proxy inherits authentication from the host's kubeconfig.

use std::process::{Child, Command, Stdio};

/// kubectl proxy service.
///
/// Starts `kubectl proxy` on a specified port, providing HTTP access to the
/// Kubernetes API. Containers can access the K8s API via this proxy using
/// `http://host-gateway:{port}`, and the proxy handles all authentication
/// using the host's kubeconfig.
#[derive(Debug)]
pub struct KubectlProxy {
    port: u16,
    process: Option<Child>,
}

impl KubectlProxy {
    /// Create a new kubectl proxy instance.
    #[must_use]
    pub fn new(port: u16) -> Self {
        Self {
            port,
            process: None,
        }
    }

    /// Check if kubectl is available in PATH.
    #[must_use]
    pub fn is_available() -> bool {
        Command::new("kubectl")
            .arg("version")
            .arg("--client")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok()
    }

    /// Start kubectl proxy.
    ///
    /// Spawns `kubectl proxy` on the configured port. The proxy will use
    /// the host's kubeconfig for authentication.
    ///
    /// # Arguments
    /// * `--port` - The port to listen on
    /// * `--reject-paths=^$` - Security: Reject direct root path access
    ///
    /// # Errors
    /// Returns an error if kubectl is not available or if the process fails to start.
    pub fn start(&mut self) -> anyhow::Result<()> {
        // Check if kubectl is available
        if !Self::is_available() {
            anyhow::bail!("kubectl not found in PATH");
        }

        // Check if already running
        if self.is_running() {
            tracing::warn!("kubectl proxy already running on port {}", self.port);
            return Ok(());
        }

        // Start kubectl proxy
        let child = Command::new("kubectl")
            .args([
                "proxy",
                "--port",
                &self.port.to_string(),
                "--reject-paths=^$",
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| anyhow::anyhow!("Failed to start kubectl proxy: {}", e))?;

        self.process = Some(child);

        // Verify proxy is bound and responding
        let mut bound = false;
        for attempt in 1..=10 {
            std::thread::sleep(std::time::Duration::from_millis(50));
            if std::net::TcpStream::connect(format!("127.0.0.1:{}", self.port)).is_ok() {
                tracing::info!("kubectl proxy started on port {}", self.port);
                bound = true;
                break;
            }
            if attempt == 10 {
                tracing::warn!(
                    port = self.port,
                    "kubectl proxy may not be ready (could not verify binding)"
                );
            }
        }

        if !bound {
            // Clean up on failure
            self.stop();
            anyhow::bail!("kubectl proxy failed to bind on port {}", self.port);
        }

        Ok(())
    }

    /// Stop kubectl proxy.
    ///
    /// Kills the kubectl proxy process if running.
    pub fn stop(&mut self) {
        if let Some(mut process) = self.process.take() {
            if let Err(e) = process.kill() {
                tracing::warn!("Failed to kill kubectl proxy process: {}", e);
            } else {
                tracing::info!("kubectl proxy stopped");
            }
        }
    }

    /// Get the port kubectl proxy is running on.
    #[must_use]
    pub fn port(&self) -> u16 {
        self.port
    }

    /// Check if kubectl proxy is currently running.
    ///
    /// This method actually verifies the process is still alive by checking its status.
    /// If the process has exited, it will be removed from the internal state.
    pub fn is_running(&mut self) -> bool {
        if let Some(ref mut process) = self.process {
            match process.try_wait() {
                Ok(Some(_status)) => {
                    // Process has exited
                    tracing::debug!("kubectl proxy process has exited");
                    self.process = None;
                    false
                }
                Ok(None) => {
                    // Process is still running
                    true
                }
                Err(e) => {
                    // Error checking status - assume not running
                    tracing::warn!("Failed to check kubectl proxy status: {}", e);
                    self.process = None;
                    false
                }
            }
        } else {
            false
        }
    }
}

impl Drop for KubectlProxy {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new() {
        let mut proxy = KubectlProxy::new(18081);
        assert_eq!(proxy.port(), 18081);
        assert!(!proxy.is_running());
    }

    #[test]
    fn test_is_available() {
        // This test will pass if kubectl is installed, skip if not
        let available = KubectlProxy::is_available();
        // Just verify it returns a boolean without panicking
        println!("kubectl available: {}", available);
    }

    #[test]
    fn test_port() {
        let proxy = KubectlProxy::new(12345);
        assert_eq!(proxy.port(), 12345);
    }
}
