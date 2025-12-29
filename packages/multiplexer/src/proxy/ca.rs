//! Proxy CA certificate generation and management.

use std::path::PathBuf;

use hudsucker::certificate_authority::RcgenAuthority;
use rcgen::{BasicConstraints, CertificateParams, DistinguishedName, DnType, IsCa, Issuer, KeyPair, KeyUsagePurpose};
use rustls::crypto::aws_lc_rs::default_provider;

/// Proxy CA for generating certificates for HTTPS interception.
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
    pub fn load_or_generate(mux_dir: &PathBuf) -> anyhow::Result<Self> {
        let cert_path = mux_dir.join("proxy-ca.pem");
        let key_path = mux_dir.join("proxy-ca-key.pem");

        if cert_path.exists() && key_path.exists() {
            tracing::info!("Loaded proxy CA certificate from {:?}", cert_path);
            Ok(Self { cert_path, key_path })
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

        Ok(Self { cert_path, key_path })
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
    pub fn cert_path(&self) -> &PathBuf {
        &self.cert_path
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

        // Verify we can create an authority
        let _authority = ca.to_rcgen_authority().unwrap();
    }

    #[test]
    fn test_ca_reload() {
        let dir = tempdir().unwrap();
        let mux_dir = dir.path().to_path_buf();

        // Generate CA
        let _ca1 = ProxyCa::load_or_generate(&mux_dir).unwrap();

        // Reload CA
        let ca2 = ProxyCa::load_or_generate(&mux_dir).unwrap();

        // Should be able to create authority
        let _authority = ca2.to_rcgen_authority().unwrap();
    }
}
