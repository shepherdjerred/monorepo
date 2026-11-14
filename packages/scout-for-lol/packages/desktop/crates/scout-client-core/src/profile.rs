//! The release profile compiled into this build.
//!
//! `release-profiles/{stable,beta}.json` are validated by `build.rs`, and
//! `SCOUT_DESKTOP_PROFILE=stable|beta` picks the one this binary carries. An
//! unset variable is a development build and gets beta. Stable keeps the
//! identifier, keyring service and data directory the client has always used
//! so existing pairings and outboxes carry over; beta has its own so it
//! installs and runs beside stable.

/// Everything that differs between the stable and beta builds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReleaseProfile {
    /// `stable` or `beta`.
    pub channel: &'static str,
    /// User-visible product name; also the installer and install directory name.
    pub product_name: &'static str,
    /// Executable name inside the installer. NSIS keys its process kill and
    /// shortcuts on it, so beta needs its own to install beside stable.
    pub binary_name: &'static str,
    /// Reverse-DNS application identifier.
    pub identifier: &'static str,
    /// Backend this build pairs with and uploads to.
    pub backend_origin: &'static str,
    /// OS credential-store service name.
    pub keyring_service: &'static str,
    /// `ProjectDirs` qualifier.
    pub data_qualifier: &'static str,
    /// `ProjectDirs` organization.
    pub data_organization: &'static str,
    /// `ProjectDirs` application, the per-user data directory name.
    pub data_application: &'static str,
    /// Name of the start-at-login registration.
    pub autostart_name: &'static str,
    /// Origin that serves this build's update channel manifest and releases.
    pub update_origin: &'static str,
    /// Base64 of the minisign public key that verifies this channel's
    /// installers. The private key is in 1Password and never in the repository.
    pub update_public_key: &'static str,
}

include!(concat!(env!("OUT_DIR"), "/release_profile.rs"));

impl ReleaseProfile {
    /// The profile this binary was built with.
    #[must_use]
    pub const fn compiled() -> Self {
        COMPILED
    }

    /// Whether this binary was built by the packaging scripts, which name
    /// their profile, rather than as a development build that defaults to
    /// beta. A development build never updates itself.
    #[must_use]
    pub const fn is_packaged() -> bool {
        PACKAGED
    }
}

#[cfg(test)]
mod tests {
    use super::{BETA, ReleaseProfile, STABLE};

    #[test]
    fn stable_keeps_the_identity_existing_installs_use() {
        assert_eq!(STABLE.product_name, "Scout Desktop");
        assert_eq!(STABLE.backend_origin, "https://scout-for-lol.com");
        assert_eq!(STABLE.binary_name, "scout-client");
        assert_eq!(STABLE.identifier, "com.scout-for-lol.client");
        assert_eq!(STABLE.keyring_service, "com.scout-for-lol.client");
        assert_eq!(STABLE.data_qualifier, "com");
        assert_eq!(STABLE.data_organization, "Scout");
        assert_eq!(STABLE.data_application, "Scout Client");
    }

    #[test]
    fn beta_installs_alongside_stable_and_targets_the_beta_backend() {
        assert_eq!(BETA.product_name, "Scout Desktop Beta");
        assert_eq!(BETA.backend_origin, "https://beta.scout-for-lol.com");
        assert_ne!(BETA.binary_name, STABLE.binary_name);
        assert_ne!(BETA.identifier, STABLE.identifier);
        assert_ne!(BETA.keyring_service, STABLE.keyring_service);
        assert_ne!(BETA.data_application, STABLE.data_application);
    }

    #[test]
    fn each_channel_verifies_updates_with_its_own_key() {
        assert_ne!(STABLE.update_public_key, BETA.update_public_key);
        assert_eq!(STABLE.update_origin, BETA.update_origin);
        assert!(STABLE.update_origin.starts_with("https://"));
    }

    #[test]
    fn a_development_build_is_beta_unless_the_profile_is_selected() {
        let expected = match option_env!("SCOUT_DESKTOP_PROFILE") {
            Some("stable") => STABLE,
            _ => BETA,
        };
        assert_eq!(ReleaseProfile::compiled(), expected);
        assert_eq!(
            ReleaseProfile::is_packaged(),
            option_env!("SCOUT_DESKTOP_PROFILE").is_some()
        );
    }
}
