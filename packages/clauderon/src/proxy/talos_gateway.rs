//! Talos mTLS gateway - terminates TLS from containers and proxies gRPC to Talos nodes with mTLS.

use std::net::SocketAddr;
use std::sync::Arc;

use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use serde::Deserialize;
use tokio::net::TcpListener;
use tokio_rustls::{TlsAcceptor, TlsConnector};

use super::ca::ProxyCa;

/// Talos gateway that terminates TLS from containers and establishes mTLS to Talos nodes.
///
/// Architecture:
/// 1. Container connects with TLS using proxy's CA
/// 2. Gateway terminates TLS, sees plaintext HTTP/2 (gRPC)
/// 3. Gateway establishes new mTLS connection to real Talos with host's cert (O=os:admin)
/// 4. Talos validates cert, extracts Organization field, grants access
/// 5. Container never needs Talos private key (zero-credential access)
#[derive(Clone)]
pub struct TalosGateway {
    /// Listen address.
    addr: SocketAddr,
    /// Proxy CA for accepting TLS from containers.
    proxy_ca: Arc<ProxyCa>,
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
    /// CA certificate (base64 encoded PEM).
    pub ca: Option<String>,
    /// Client certificate (base64 encoded PEM).
    pub crt: Option<String>,
    /// Client key (base64 encoded PEM).
    pub key: Option<String>,
}

impl TalosGateway {
    /// Create a new Talos gateway.
    pub fn new(port: u16, proxy_ca: Arc<ProxyCa>) -> Self {
        Self {
            addr: SocketAddr::from(([127, 0, 0, 1], port)),
            proxy_ca,
            config: None,
        }
    }

    /// Load Talos configuration from ~/.talos/config.
    pub fn load_config(&mut self) -> anyhow::Result<()> {
        let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("no home directory"))?;
        let config_path = home.join(".talos/config");

        if !config_path.exists() {
            tracing::debug!("Talos config not found at {:?}", config_path);
            return Ok(());
        }

        let content = std::fs::read_to_string(&config_path)?;
        let config: TalosConfig = serde_yaml::from_str(&content)?;

        tracing::info!(
            "Loaded Talos config with {} contexts, current: {}",
            config.contexts.len(),
            config.context
        );

        self.config = Some(config);
        Ok(())
    }

    /// Get the current context.
    pub fn current_context(&self) -> Option<&TalosContext> {
        self.config
            .as_ref()
            .and_then(|c| c.contexts.get(&c.context))
    }

    /// Get endpoints from current context.
    pub fn endpoints(&self) -> Vec<String> {
        self.current_context()
            .map(|ctx| ctx.endpoints.clone())
            .unwrap_or_default()
    }

    /// Build a TLS connector with client certificates for mTLS.
    fn build_tls_connector(&self) -> anyhow::Result<TlsConnector> {
        let context = self
            .current_context()
            .ok_or_else(|| anyhow::anyhow!("no current context"))?;

        // Decode base64 certificates
        let ca_pem = context
            .ca
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("no CA certificate in context"))?;
        let client_cert_pem = context
            .crt
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("no client certificate in context"))?;
        let client_key_pem = context
            .key
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("no client key in context"))?;

        // Parse CA certificate
        let ca_pem_decoded = base64_decode(ca_pem)?;
        let ca_certs =
            rustls_pemfile::certs(&mut ca_pem_decoded.as_slice()).collect::<Result<Vec<_>, _>>()?;

        // Build root cert store
        let mut root_store = rustls::RootCertStore::empty();
        for cert in ca_certs {
            root_store.add(cert)?;
        }

        // Parse client certificate and key
        let client_cert_decoded = base64_decode(client_cert_pem)?;
        let client_certs: Vec<CertificateDer<'static>> =
            rustls_pemfile::certs(&mut client_cert_decoded.as_slice())
                .collect::<Result<Vec<_>, _>>()?;

        let client_key_decoded = base64_decode(client_key_pem)?;

        // Parse private key - handle all PEM formats including Ed25519
        let client_key: PrivateKeyDer<'static> = {
            // Check if this is an Ed25519 key in OpenSSL format
            let pem_str = String::from_utf8_lossy(&client_key_decoded);
            if pem_str.contains("-----BEGIN ED25519 PRIVATE KEY-----") {
                // Manually parse Ed25519 key and convert to PKCS#8
                parse_ed25519_key(&client_key_decoded)?
            } else {
                // Try standard rustls_pemfile parsing for other formats
                use rustls_pemfile::Item;

                let mut cursor = client_key_decoded.as_slice();
                let items = rustls_pemfile::read_all(&mut cursor).collect::<Result<Vec<_>, _>>()?;

                // Find the first private key item
                items
                    .into_iter()
                    .find_map(|item| match item {
                        Item::Pkcs8Key(key) => Some(PrivateKeyDer::Pkcs8(key)),
                        Item::Pkcs1Key(key) => Some(PrivateKeyDer::Pkcs1(key)),
                        Item::Sec1Key(key) => Some(PrivateKeyDer::Sec1(key)),
                        _ => None,
                    })
                    .ok_or_else(|| {
                        anyhow::anyhow!(
                            "No private key found in PEM. Parsed items but none were private keys."
                        )
                    })?
            }
        };

        // Build TLS config with client auth
        let config = rustls::ClientConfig::builder()
            .with_root_certificates(root_store)
            .with_client_auth_cert(client_certs, client_key)?;

        Ok(TlsConnector::from(Arc::new(config)))
    }

    /// Run the gateway server.
    pub async fn run(self) -> anyhow::Result<()> {
        if self.config.is_none() {
            tracing::debug!("No Talos config loaded, gateway disabled");
            return Ok(());
        }

        let listener = TcpListener::bind(self.addr).await?;
        tracing::info!("Talos mTLS gateway listening on {}", self.addr);

        // Build TLS acceptor for accepting connections from containers
        let server_config = match self.proxy_ca.build_server_config() {
            Ok(config) => Arc::new(config),
            Err(e) => {
                tracing::error!("Failed to build TLS server config: {}", e);
                return Err(e);
            }
        };
        let tls_acceptor = TlsAcceptor::from(server_config);

        // Pre-build TLS connector for mTLS to Talos (validates config)
        let tls_connector = match self.build_tls_connector() {
            Ok(c) => Arc::new(c),
            Err(e) => {
                tracing::warn!("Failed to build TLS connector: {}. Gateway disabled.", e);
                return Ok(());
            }
        };

        loop {
            let (stream, client_addr) = listener.accept().await?;
            let gateway = self.clone();
            let acceptor = tls_acceptor.clone();
            let connector = Arc::clone(&tls_connector);

            tokio::spawn(async move {
                if let Err(e) =
                    handle_talos_connection(stream, client_addr, gateway, acceptor, connector).await
                {
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

/// Parse Ed25519 private key in OpenSSL format and convert to PKCS#8.
fn parse_ed25519_key(pem_bytes: &[u8]) -> anyhow::Result<PrivateKeyDer<'static>> {
    use rustls::pki_types::PrivatePkcs8KeyDer;

    // Find PEM boundaries
    let pem_str = String::from_utf8_lossy(pem_bytes);
    let begin_marker = "-----BEGIN ED25519 PRIVATE KEY-----";
    let end_marker = "-----END ED25519 PRIVATE KEY-----";

    let start = pem_str
        .find(begin_marker)
        .ok_or_else(|| anyhow::anyhow!("Ed25519 PEM begin marker not found"))?
        + begin_marker.len();

    let end = pem_str
        .find(end_marker)
        .ok_or_else(|| anyhow::anyhow!("Ed25519 PEM end marker not found"))?;

    // Extract base64 content and decode
    let b64_content = &pem_str[start..end];
    let der_bytes = decode_base64_raw(b64_content)?;

    // Validate DER structure is PKCS#8 format
    // Expected structure for Ed25519:
    //   SEQUENCE {
    //     version INTEGER (0)
    //     algorithm SEQUENCE { OID 1.3.101.112 (Ed25519) }
    //     privateKey OCTET STRING (containing the key material)
    //   }
    if der_bytes.len() < 16 {
        anyhow::bail!("Ed25519 key too short to be valid PKCS#8");
    }
    if der_bytes[0] != 0x30 {
        anyhow::bail!(
            "Ed25519 key does not start with SEQUENCE tag (expected 0x30, got 0x{:02x})",
            der_bytes[0]
        );
    }
    // Check for Ed25519 OID (1.3.101.112 = 0x2B 0x65 0x70)
    let has_ed25519_oid = der_bytes.windows(3).any(|w| w == [0x2B, 0x65, 0x70]);
    if !has_ed25519_oid {
        anyhow::bail!("Ed25519 key missing Ed25519 OID (1.3.101.112)");
    }

    // The OpenSSL Ed25519 format (-----BEGIN ED25519 PRIVATE KEY-----) uses
    // the same DER encoding as PKCS#8, just with a different PEM label.
    // RFC 8410 specifies PKCS#8 for Ed25519, and OpenSSL's format is compatible.
    Ok(PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(der_bytes)))
}

/// Simple base64 decoder (without PEM detection).
fn decode_base64_raw(s: &str) -> anyhow::Result<Vec<u8>> {
    const DECODE_TABLE: [i8; 256] = {
        let mut table = [-1i8; 256];
        let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut i = 0;
        while i < 64 {
            table[alphabet[i] as usize] = i as i8;
            i += 1;
        }
        table
    };

    let cleaned: String = s.chars().filter(|c| !c.is_whitespace()).collect();
    let bytes = cleaned.as_bytes();
    let mut output = Vec::new();
    let mut i = 0;

    while i < bytes.len() {
        let mut chunk = [0u8; 4];
        let mut valid = 0;

        for j in 0..4 {
            if i + j >= bytes.len() {
                break;
            }
            let b = bytes[i + j];
            if b == b'=' {
                break;
            }
            let val = DECODE_TABLE[b as usize];
            if val < 0 {
                anyhow::bail!("invalid base64 character at position {}", i + j);
            }
            chunk[j] = val as u8;
            valid += 1;
        }

        if valid >= 2 {
            output.push((chunk[0] << 2) | (chunk[1] >> 4));
        }
        if valid >= 3 {
            output.push((chunk[1] << 4) | (chunk[2] >> 2));
        }
        if valid >= 4 {
            output.push((chunk[2] << 6) | chunk[3]);
        }

        i += 4;
    }

    Ok(output)
}

/// Decode base64 string to bytes (with PEM format detection).
fn base64_decode(s: &str) -> anyhow::Result<Vec<u8>> {
    // Talos config may have the cert as raw PEM or base64-encoded PEM
    // Try to detect which one it is
    if s.contains("-----BEGIN") {
        // Already PEM format
        Ok(s.as_bytes().to_vec())
    } else {
        // Base64 encoded - decode it
        decode_base64_raw(s)
    }
}

/// Handle a Talos gRPC connection with TLS termination.
///
/// Flow:
/// 1. Accept TLS from container (using proxy's CA)
/// 2. Terminate TLS to see plaintext HTTP/2
/// 3. Establish mTLS to real Talos (using host's cert with O=os:admin)
/// 4. Bidirectionally forward HTTP/2 frames
async fn handle_talos_connection(
    client_stream: tokio::net::TcpStream,
    client_addr: SocketAddr,
    gateway: TalosGateway,
    tls_acceptor: TlsAcceptor,
    tls_connector: Arc<TlsConnector>,
) -> anyhow::Result<()> {
    let context = gateway
        .current_context()
        .ok_or_else(|| anyhow::anyhow!("no context"))?;

    // Get first endpoint
    let endpoint = context
        .endpoints
        .first()
        .ok_or_else(|| anyhow::anyhow!("no endpoints"))?;

    // Parse endpoint (format: "hostname:port" or just "hostname")
    let (host, port) = if let Some(colon_idx) = endpoint.rfind(':') {
        let host = &endpoint[..colon_idx];
        let port: u16 = endpoint[colon_idx + 1..]
            .parse()
            .map_err(|e| anyhow::anyhow!("invalid port in endpoint '{}': {}", endpoint, e))?;
        (host.to_string(), port)
    } else {
        (endpoint.clone(), 50000)
    };

    tracing::debug!(
        "Proxying Talos connection from {} to {}:{} (with TLS termination)",
        client_addr,
        host,
        port
    );

    // Step 1: Accept TLS from container
    let client_tls_stream = match tls_acceptor.accept(client_stream).await {
        Ok(stream) => stream,
        Err(e) => {
            tracing::warn!("Failed to accept TLS from {}: {}", client_addr, e);
            return Err(e.into());
        }
    };

    tracing::debug!(
        "TLS accepted from {}, establishing mTLS to Talos",
        client_addr
    );

    // Step 2: Connect to Talos node with mTLS
    let upstream_tcp = tokio::net::TcpStream::connect(format!("{host}:{port}")).await?;

    // Establish TLS with mTLS client auth (using host's cert with O=os:admin)
    let server_name = rustls::pki_types::ServerName::try_from(host.clone())?;
    let upstream_tls_stream = tls_connector.connect(server_name, upstream_tcp).await?;

    tracing::debug!(
        "mTLS established to Talos at {}:{}, forwarding traffic",
        host,
        port
    );

    // Step 3: Bidirectional copy (plaintext HTTP/2 from container ↔ mTLS to Talos)
    let (mut client_read, mut client_write) = tokio::io::split(client_tls_stream);
    let (mut upstream_read, mut upstream_write) = tokio::io::split(upstream_tls_stream);

    let client_to_upstream = tokio::io::copy(&mut client_read, &mut upstream_write);
    let upstream_to_client = tokio::io::copy(&mut upstream_read, &mut client_write);

    tokio::select! {
        r = client_to_upstream => {
            if let Err(e) = r {
                tracing::debug!("Client to upstream error: {}", e);
            }
        }
        r = upstream_to_client => {
            if let Err(e) = r {
                tracing::debug!("Upstream to client error: {}", e);
            }
        }
    };

    tracing::debug!("Connection from {} completed", client_addr);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gateway_creation() {
        use tempfile::tempdir;
        let dir = tempdir().unwrap();
        let proxy_ca = Arc::new(ProxyCa::load_or_generate(&dir.path().to_path_buf()).unwrap());

        let gateway = TalosGateway::new(18082, proxy_ca);
        assert_eq!(gateway.addr().port(), 18082);
        assert!(!gateway.is_configured());
    }

    #[test]
    fn test_gateway_is_clone() {
        use tempfile::tempdir;
        let dir = tempdir().unwrap();
        let proxy_ca = Arc::new(ProxyCa::load_or_generate(&dir.path().to_path_buf()).unwrap());

        let gateway = TalosGateway::new(18082, proxy_ca);
        let cloned = gateway.clone();
        // Use both to avoid clippy warnings
        drop(gateway);
        drop(cloned);
    }

    #[test]
    fn test_base64_decode_pem() {
        let pem = "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----";
        let result = base64_decode(pem).unwrap();
        assert_eq!(result, pem.as_bytes());
    }

    #[test]
    fn test_base64_decode_encoded() {
        // "hello" in base64
        let encoded = "aGVsbG8=";
        let result = base64_decode(encoded).unwrap();
        assert_eq!(result, b"hello");
    }
}
