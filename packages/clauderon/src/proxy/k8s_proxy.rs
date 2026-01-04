//! Kubernetes proxy wrapper - wraps kubectl proxy as subprocess.

use std::process::{Child, Command, Stdio};
use std::time::Duration;

/// Kubernetes proxy that wraps kubectl proxy subprocess.
pub struct KubernetesProxy {
    /// The kubectl proxy subprocess.
    process: Option<Child>,
    /// Port to listen on.
    port: u16,
}

impl KubernetesProxy {
    /// Create a new Kubernetes proxy wrapper.
    pub fn new(port: u16) -> Self {
        Self {
            process: None,
            port,
        }
    }

    /// Start the kubectl proxy subprocess.
    pub async fn start(&mut self) -> anyhow::Result<()> {
        if self.is_running() {
            tracing::debug!("kubectl proxy already running");
            return Ok(());
        }

        // Check if kubectl is available
        if Command::new("kubectl")
            .arg("version")
            .arg("--client")
            .output()
            .is_err()
        {
            tracing::warn!("kubectl not found, skipping Kubernetes proxy");
            return Ok(());
        }

        tracing::info!("Starting kubectl proxy on port {}", self.port);

        let child = Command::new("kubectl")
            .args([
                "proxy",
                "--port",
                &self.port.to_string(),
                "--address",
                "127.0.0.1",
                "--accept-hosts",
                "^host\\.docker\\.internal$,^localhost$,^127\\.0\\.0\\.1$",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        self.process = Some(child);

        // Wait for proxy to be ready with retries
        for attempt in 1..=10 {
            tokio::time::sleep(Duration::from_millis(100)).await;
            if self.health_check().await {
                tracing::info!("kubectl proxy started successfully on port {}", self.port);
                return Ok(());
            }
            tracing::debug!("kubectl proxy not ready yet (attempt {})", attempt);
        }

        // Final check - process might have died
        if self.is_running() {
            tracing::info!(
                "kubectl proxy started on port {} (health check unavailable)",
                self.port
            );
        } else {
            tracing::error!("kubectl proxy failed to start");
        }

        Ok(())
    }

    /// Stop the kubectl proxy subprocess.
    ///
    /// **Note:** This method performs blocking I/O (`child.wait()`). In async contexts,
    /// call this method explicitly before dropping the `KubernetesProxy` to avoid
    /// blocking the tokio runtime. The `Drop` implementation calls this as best-effort
    /// cleanup but may cause runtime warnings if called during async shutdown.
    pub fn stop(&mut self) -> anyhow::Result<()> {
        if let Some(mut child) = self.process.take() {
            tracing::info!("Stopping kubectl proxy");
            child.kill()?;
            child.wait()?;
        }
        Ok(())
    }

    /// Check if a process was started (without checking if it's still alive).
    /// This is a non-mutable check suitable for status reporting.
    pub fn has_process(&self) -> bool {
        self.process.is_some()
    }

    /// Check if the proxy is running.
    pub fn is_running(&mut self) -> bool {
        if let Some(ref mut child) = self.process {
            match child.try_wait() {
                Ok(None) => true, // Still running
                Ok(Some(_)) => {
                    self.process = None;
                    false
                }
                Err(_) => false,
            }
        } else {
            false
        }
    }

    /// Health check - try to reach the proxy.
    pub async fn health_check(&self) -> bool {
        let url = format!("http://127.0.0.1:{port}/healthz", port = self.port);

        match reqwest_lite_health_check(&url).await {
            Ok(true) => true,
            _ => false,
        }
    }

    /// Restart the proxy if it's not running.
    pub async fn restart_if_dead(&mut self) -> anyhow::Result<()> {
        if !self.is_running() {
            tracing::warn!("kubectl proxy died, restarting...");
            self.start().await?;
        }
        Ok(())
    }

    /// Get the port.
    pub fn port(&self) -> u16 {
        self.port
    }
}

impl Drop for KubernetesProxy {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

/// Simple health check without pulling in reqwest.
async fn reqwest_lite_health_check(url: &str) -> anyhow::Result<bool> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpStream;

    let addr = url
        .strip_prefix("http://")
        .and_then(|s| s.split('/').next())
        .ok_or_else(|| anyhow::anyhow!("invalid url"))?;

    let mut stream = TcpStream::connect(addr).await?;

    let request = format!(
        "GET /healthz HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n",
        addr
    );

    stream.write_all(request.as_bytes()).await?;

    let mut response = String::new();
    stream.read_to_string(&mut response).await?;

    Ok(response.contains("200 OK") || response.contains("ok"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_proxy_creation() {
        let proxy = KubernetesProxy::new(18081);
        assert_eq!(proxy.port(), 18081);
    }

    #[test]
    fn test_proxy_not_running_initially() {
        let mut proxy = KubernetesProxy::new(18081);
        assert!(!proxy.is_running());
    }
}
