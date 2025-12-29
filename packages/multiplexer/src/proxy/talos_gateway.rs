//! Talos mTLS gateway - terminates mTLS and proxies gRPC to Talos nodes.

use std::net::SocketAddr;

use serde::Deserialize;
use tokio::net::TcpListener;

/// Talos gateway that terminates mTLS for container access.
pub struct TalosGateway {
    /// Listen address.
    addr: SocketAddr,
    /// Talos config (loaded from ~/.talos/config).
    config: Option<TalosConfig>,
}

/// Parsed Talos configuration.
#[derive(Debug, Clone, Deserialize)]
pub struct TalosConfig {
    /// Current context name.
    pub context: String,
    /// Available contexts.
    pub contexts: std::collections::HashMap<String, TalosContext>,
}

/// A Talos context.
#[derive(Debug, Clone, Deserialize)]
pub struct TalosContext {
    /// Endpoints (Talos node addresses).
    pub endpoints: Vec<String>,
    /// Nodes to connect to.
    pub nodes: Option<Vec<String>>,
    /// CA certificate (base64 encoded).
    pub ca: Option<String>,
    /// Client certificate (base64 encoded).
    pub crt: Option<String>,
    /// Client key (base64 encoded).
    pub key: Option<String>,
}

impl TalosGateway {
    /// Create a new Talos gateway.
    pub fn new(port: u16) -> Self {
        Self {
            addr: SocketAddr::from(([127, 0, 0, 1], port)),
            config: None,
        }
    }

    /// Load Talos configuration from ~/.talos/config.
    pub fn load_config(&mut self) -> anyhow::Result<()> {
        let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("no home directory"))?;
        let config_path = home.join(".talos/config");

        if !config_path.exists() {
            tracing::warn!("Talos config not found at {:?}", config_path);
            return Ok(());
        }

        let content = std::fs::read_to_string(&config_path)?;
        let config: TalosConfig = serde_yaml_parse(&content)?;

        tracing::info!(
            "Loaded Talos config with {} contexts",
            config.contexts.len()
        );

        self.config = Some(config);
        Ok(())
    }

    /// Get the current context.
    pub fn current_context(&self) -> Option<&TalosContext> {
        self.config.as_ref().and_then(|c| {
            c.contexts.get(&c.context)
        })
    }

    /// Get endpoints from current context.
    pub fn endpoints(&self) -> Vec<String> {
        self.current_context()
            .map(|ctx| ctx.endpoints.clone())
            .unwrap_or_default()
    }

    /// Run the gateway server.
    pub async fn run(&self) -> anyhow::Result<()> {
        if self.config.is_none() {
            tracing::warn!("No Talos config loaded, gateway disabled");
            return Ok(());
        }

        let listener = TcpListener::bind(self.addr).await?;
        tracing::info!("Talos mTLS gateway listening on {}", self.addr);

        loop {
            let (stream, client_addr) = listener.accept().await?;
            let config = self.config.clone();

            tokio::spawn(async move {
                if let Err(e) = handle_talos_connection(stream, client_addr, config).await {
                    tracing::error!("Talos connection error from {}: {}", client_addr, e);
                }
            });
        }
    }

    /// Get the listen address.
    pub fn addr(&self) -> SocketAddr {
        self.addr
    }

    /// Check if the gateway is configured.
    pub fn is_configured(&self) -> bool {
        self.config.is_some()
    }
}

/// Handle a Talos gRPC connection.
async fn handle_talos_connection(
    mut client_stream: tokio::net::TcpStream,
    client_addr: SocketAddr,
    config: Option<TalosConfig>,
) -> anyhow::Result<()> {

    let config = config.ok_or_else(|| anyhow::anyhow!("no config"))?;
    let context = config
        .contexts
        .get(&config.context)
        .ok_or_else(|| anyhow::anyhow!("context not found"))?;

    // Get first endpoint
    let endpoint = context
        .endpoints
        .first()
        .ok_or_else(|| anyhow::anyhow!("no endpoints"))?;

    tracing::debug!("Proxying Talos connection from {} to {}", client_addr, endpoint);

    // Parse endpoint (format: "hostname:port" or just "hostname")
    let endpoint_addr = if endpoint.contains(':') {
        endpoint.clone()
    } else {
        format!("{}:50000", endpoint)
    };

    // Connect to Talos node with mTLS
    // TODO: Full mTLS implementation with client certs from config
    let mut upstream = tokio::net::TcpStream::connect(&endpoint_addr).await?;

    // For now, just proxy raw TCP (won't work without mTLS)
    // Full implementation needs rustls with client cert
    let (mut client_read, mut client_write) = client_stream.split();
    let (mut upstream_read, mut upstream_write) = upstream.split();

    let client_to_upstream = async {
        tokio::io::copy(&mut client_read, &mut upstream_write).await
    };

    let upstream_to_client = async {
        tokio::io::copy(&mut upstream_read, &mut client_write).await
    };

    tokio::select! {
        r = client_to_upstream => r?,
        r = upstream_to_client => r?,
    };

    Ok(())
}

/// Parse YAML without pulling in serde_yaml (use simple parsing for now).
fn serde_yaml_parse<T: serde::de::DeserializeOwned>(_content: &str) -> anyhow::Result<T> {
    // For now, this is a placeholder - we'd need serde_yaml
    // The actual implementation would use:
    // serde_yaml::from_str(content).map_err(Into::into)

    anyhow::bail!("YAML parsing not yet implemented - add serde_yaml dependency")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gateway_creation() {
        let gateway = TalosGateway::new(18082);
        assert_eq!(gateway.addr().port(), 18082);
        assert!(!gateway.is_configured());
    }
}
