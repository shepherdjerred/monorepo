//! Proxy CA certificate generation and management.

use std::path::PathBuf;

use hudsucker::certificate_authority::RcgenAuthority;
use rcgen::{
    BasicConstraints, CertificateParams, DistinguishedName, DnType, IsCa, Issuer, KeyPair,
    KeyUsagePurpose,
};
use rustls::crypto::aws_lc_rs::default_provider;

/// Proxy CA for generating certificates for HTTPS interception.
#[derive(Clone, Debug)]
pub struct ProxyCa {
    /// Path where CA cert PEM is stored.
    cert_path: PathBuf,
    /// Path where CA key PEM is stored.
    key_path: PathBuf,
}

impl ProxyCa {
    /// Load or generate a CA certificate.
    ///
    /// If the CA exists at the given path, it will be loaded.
    /// Otherwise, a new CA will be generated and saved.
    pub fn load_or_generate(clauderon_dir: &PathBuf) -> anyhow::Result<Self> {
        let cert_path = clauderon_dir.join("proxy-ca.pem");
        let key_path = clauderon_dir.join("proxy-ca-key.pem");

        if cert_path.exists() && key_path.exists() {
            tracing::info!("Loaded proxy CA certificate from {:?}", cert_path);
            Ok(Self {
                cert_path,
                key_path,
            })
        } else {
            Self::generate(clauderon_dir)
        }
    }

    /// Generate a new CA certificate.
    fn generate(clauderon_dir: &PathBuf) -> anyhow::Result<Self> {
        std::fs::create_dir_all(clauderon_dir)?;

        let mut params = CertificateParams::default();

        // Set CA distinguished name
        let mut dn = DistinguishedName::new();
        dn.push(DnType::CommonName, "Clauderon Proxy CA");
        dn.push(DnType::OrganizationName, "Clauderon");
        params.distinguished_name = dn;

        // CA settings
        params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        params.key_usages = vec![
            KeyUsagePurpose::KeyCertSign,
            KeyUsagePurpose::CrlSign,
            KeyUsagePurpose::DigitalSignature,
        ];

        // Valid for 10 years
        params.not_before = time::OffsetDateTime::now_utc();
        params.not_after = params.not_before + time::Duration::days(3650);

        // Generate key pair
        let key_pair = KeyPair::generate()?;
        let ca_cert = params.self_signed(&key_pair)?;

        // Save to files
        let cert_path = clauderon_dir.join("proxy-ca.pem");
        let key_path = clauderon_dir.join("proxy-ca-key.pem");

        std::fs::write(&cert_path, ca_cert.pem())?;
        std::fs::write(&key_path, key_pair.serialize_pem())?;

        // Set restrictive permissions on key file
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o600))?;
        }

        tracing::info!("Generated new proxy CA certificate at {:?}", cert_path);

        Ok(Self {
            cert_path,
            key_path,
        })
    }

    /// Create a hudsucker RcgenAuthority from this CA.
    pub fn to_rcgen_authority(&self) -> anyhow::Result<RcgenAuthority> {
        // Read PEM files
        let cert_pem = std::fs::read_to_string(&self.cert_path)?;
        let key_pem = std::fs::read_to_string(&self.key_path)?;

        // Parse key pair from PEM
        let key_pair = KeyPair::from_pem(&key_pem)?;

        // Create Issuer from CA cert PEM
        let issuer = Issuer::from_ca_cert_pem(&cert_pem, key_pair)?;

        // Create RcgenAuthority with certificate cache
        let provider = default_provider();
        let authority = RcgenAuthority::new(issuer, 1000, provider);

        Ok(authority)
    }

    /// Get the path to the CA certificate PEM file.
    #[must_use]
    pub fn cert_path(&self) -> &PathBuf {
        &self.cert_path
    }

    /// Build a rustls ServerConfig for accepting TLS connections with dynamic certificate generation.
    ///
    /// This generates a server certificate on-the-fly for accepting TLS connections.
    /// Used by the Talos gateway to terminate TLS from containers.
    pub fn build_server_config(&self) -> anyhow::Result<rustls::ServerConfig> {
        use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};

        // Read CA cert and key
        let ca_cert_pem = std::fs::read_to_string(&self.cert_path)?;
        let ca_key_pem = std::fs::read_to_string(&self.key_path)?;

        // Parse CA key pair for signing
        let ca_key_pair = KeyPair::from_pem(&ca_key_pem)?;

        // Create Issuer from CA cert
        let issuer = Issuer::from_ca_cert_pem(&ca_cert_pem, ca_key_pair)?;

        // Generate server certificate signed by our CA
        // This certificate will be presented to clients connecting to the gateway
        let mut server_params = CertificateParams::default();
        let mut dn = DistinguishedName::new();
        dn.push(DnType::CommonName, "Clauderon Talos Gateway");
        server_params.distinguished_name = dn;

        // Add localhost and common IPs as subject alternative names
        server_params.subject_alt_names =
            vec![
                rcgen::SanType::DnsName(
                    "localhost"
                        .to_owned()
                        .try_into()
                        .map_err(|e| anyhow::anyhow!("Invalid DNS name 'localhost': {e}"))?,
                ),
                rcgen::SanType::IpAddress(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)),
                rcgen::SanType::DnsName("host.docker.internal".to_owned().try_into().map_err(
                    |e| anyhow::anyhow!("Invalid DNS name 'host.docker.internal': {e}"),
                )?),
            ];

        // Valid for 1 year
        server_params.not_before = time::OffsetDateTime::now_utc();
        server_params.not_after = server_params.not_before + time::Duration::days(365);

        // Generate server key pair
        let server_key_pair = KeyPair::generate()?;

        // Sign server cert with CA using Issuer
        let server_cert = server_params.signed_by(&server_key_pair, &issuer)?;

        // Convert to rustls types
        let server_cert_der = CertificateDer::from(server_cert.der().to_vec());
        let server_key_der =
            PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(server_key_pair.serialize_der()));

        // Build ServerConfig
        let config = rustls::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(vec![server_cert_der], server_key_der)?;

        Ok(config)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_ca_generation() {
        let dir = tempdir().unwrap();
        let clauderon_dir = dir.path().to_path_buf();

        let ca = ProxyCa::load_or_generate(&clauderon_dir).unwrap();

        // Verify files were created
        assert!(clauderon_dir.join("proxy-ca.pem").exists());
        assert!(clauderon_dir.join("proxy-ca-key.pem").exists());

        // Verify we can create an authority
        let _authority = ca.to_rcgen_authority().unwrap();
    }

    #[test]
    fn test_ca_reload() {
        let dir = tempdir().unwrap();
        let clauderon_dir = dir.path().to_path_buf();

        // Generate CA
        let _ca1 = ProxyCa::load_or_generate(&clauderon_dir).unwrap();

        // Reload CA
        let ca2 = ProxyCa::load_or_generate(&clauderon_dir).unwrap();

        // Should be able to create authority
        let _authority = ca2.to_rcgen_authority().unwrap();
    }
}
