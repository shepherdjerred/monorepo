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
pub struct KubectlProxy {
    port: u16,
    process: Option<Child>,
}

impl KubectlProxy {
    /// Create a new kubectl proxy instance.
    pub fn new(port: u16) -> Self {
        Self {
            port,
            process: None,
        }
    }

    /// Check if kubectl is available in PATH.
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
        if self.process.is_some() {
            tracing::warn!("kubectl proxy already running on port {}", self.port);
            return Ok(());
        }

        // Start kubectl proxy
        let child = Command::new("kubectl")
            .args(&[
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
        tracing::info!("kubectl proxy started on port {}", self.port);
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
    pub fn port(&self) -> u16 {
        self.port
    }

    /// Check if kubectl proxy is currently running.
    pub fn is_running(&self) -> bool {
        self.process.is_some()
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
        let proxy = KubectlProxy::new(18081);
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
