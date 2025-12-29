//! Proxy CA certificate generation and management.

use std::path::PathBuf;
use std::sync::Arc;

use rcgen::{
    BasicConstraints, Certificate, CertificateParams, DistinguishedName, DnType, IsCa, KeyPair,
    KeyUsagePurpose, SanType,
};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};

/// Proxy CA for generating certificates for HTTPS interception.
pub struct ProxyCa {
    /// CA certificate.
    ca_cert: Certificate,
    /// CA key pair.
    ca_key: KeyPair,
    /// Path where CA cert is stored.
    cert_path: PathBuf,
}

impl ProxyCa {
    /// Load or generate a CA certificate.
    ///
    /// If the CA exists at the given path, it will be loaded.
    /// Otherwise, a new CA will be generated and saved.
    pub fn load_or_generate(mux_dir: &PathBuf) -> anyhow::Result<Self> {
        let cert_path = mux_dir.join("proxy-ca.pem");
        let key_path = mux_dir.join("proxy-ca-key.pem");

        if cert_path.exists() && key_path.exists() {
            Self::load(&cert_path, &key_path)
        } else {
            Self::generate(mux_dir)
        }
    }

    /// Generate a new CA certificate.
    fn generate(mux_dir: &PathBuf) -> anyhow::Result<Self> {
        std::fs::create_dir_all(mux_dir)?;

        let mut params = CertificateParams::default();

        // Set CA distinguished name
        let mut dn = DistinguishedName::new();
        dn.push(DnType::CommonName, "Mux Proxy CA");
        dn.push(DnType::OrganizationName, "Mux");
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
        let cert_path = mux_dir.join("proxy-ca.pem");
        let key_path = mux_dir.join("proxy-ca-key.pem");

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
            ca_cert,
            ca_key: key_pair,
            cert_path,
        })
    }

    /// Load an existing CA certificate.
    fn load(cert_path: &PathBuf, key_path: &PathBuf) -> anyhow::Result<Self> {
        let key_pem = std::fs::read_to_string(key_path)?;
        let key_pair = KeyPair::from_pem(&key_pem)?;

        // Recreate CA params (we can't parse from PEM, so regenerate with same key)
        let mut params = CertificateParams::default();
        let mut dn = DistinguishedName::new();
        dn.push(DnType::CommonName, "Mux Proxy CA");
        dn.push(DnType::OrganizationName, "Mux");
        params.distinguished_name = dn;
        params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        params.key_usages = vec![
            KeyUsagePurpose::KeyCertSign,
            KeyUsagePurpose::CrlSign,
            KeyUsagePurpose::DigitalSignature,
        ];
        params.not_before = time::OffsetDateTime::now_utc();
        params.not_after = params.not_before + time::Duration::days(3650);

        let ca_cert = params.self_signed(&key_pair)?;

        tracing::info!("Loaded proxy CA certificate from {:?}", cert_path);

        Ok(Self {
            ca_cert,
            ca_key: key_pair,
            cert_path: cert_path.clone(),
        })
    }

    /// Generate a certificate for a specific hostname.
    pub fn generate_cert_for_host(&self, hostname: &str) -> anyhow::Result<(Vec<u8>, Vec<u8>)> {
        let mut params = CertificateParams::default();

        // Set distinguished name
        let mut dn = DistinguishedName::new();
        dn.push(DnType::CommonName, hostname);
        params.distinguished_name = dn;

        // Add SAN
        params.subject_alt_names = vec![SanType::DnsName(hostname.try_into()?)];

        // Key usage for server cert
        params.key_usages = vec![
            KeyUsagePurpose::DigitalSignature,
            KeyUsagePurpose::KeyEncipherment,
        ];

        // Valid for 1 day (ephemeral)
        params.not_before = time::OffsetDateTime::now_utc();
        params.not_after = params.not_before + time::Duration::days(1);

        // Generate key and sign with CA
        let key_pair = KeyPair::generate()?;
        let cert = params.signed_by(&key_pair, &self.ca_cert, &self.ca_key)?;

        Ok((cert.der().to_vec(), key_pair.serialize_der()))
    }

    /// Get the CA certificate in DER format for rustls.
    pub fn ca_cert_der(&self) -> CertificateDer<'static> {
        CertificateDer::from(self.ca_cert.der().to_vec())
    }

    /// Get the path to the CA certificate PEM file.
    pub fn cert_path(&self) -> &PathBuf {
        &self.cert_path
    }

    /// Create a rustls server config for a given hostname.
    pub fn make_server_config(&self, hostname: &str) -> anyhow::Result<Arc<rustls::ServerConfig>> {
        let (cert_der, key_der) = self.generate_cert_for_host(hostname)?;

        let cert = CertificateDer::from(cert_der);
        let key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(key_der));

        let config = rustls::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(vec![cert], key)?;

        Ok(Arc::new(config))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_ca_generation() {
        let dir = tempdir().unwrap();
        let mux_dir = dir.path().to_path_buf();

        let ca = ProxyCa::load_or_generate(&mux_dir).unwrap();

        // Verify files were created
        assert!(mux_dir.join("proxy-ca.pem").exists());
        assert!(mux_dir.join("proxy-ca-key.pem").exists());

        // Verify we can generate host certs
        let (cert, key) = ca.generate_cert_for_host("api.github.com").unwrap();
        assert!(!cert.is_empty());
        assert!(!key.is_empty());
    }

    #[test]
    fn test_ca_reload() {
        let dir = tempdir().unwrap();
        let mux_dir = dir.path().to_path_buf();

        // Generate CA
        let _ca1 = ProxyCa::load_or_generate(&mux_dir).unwrap();

        // Reload CA
        let ca2 = ProxyCa::load_or_generate(&mux_dir).unwrap();

        // Should be able to generate certs
        let (cert, _) = ca2.generate_cert_for_host("example.com").unwrap();
        assert!(!cert.is_empty());
    }
}
