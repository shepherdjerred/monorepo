use std::sync::Arc;
use webauthn_rs::prelude::*;

/// WebAuthn handler for passkey operations
#[derive(Clone)]
pub struct WebAuthnHandler {
    webauthn: Arc<Webauthn>,
}

impl WebAuthnHandler {
    /// Create a new WebAuthn handler
    ///
    /// # Arguments
    /// * `rp_origin` - Relying Party origin (e.g., "http://localhost:3030" or "https://clauderon.example.com")
    /// * `rp_id` - Relying Party ID (e.g., "localhost" or "clauderon.example.com")
    ///
    /// # Errors
    /// Returns an error if the WebAuthn builder fails to construct
    pub fn new(rp_origin: &str, rp_id: &str) -> anyhow::Result<Self> {
        let rp_origin = Url::parse(rp_origin)?;

        let builder = WebauthnBuilder::new(rp_id, &rp_origin)?;
        let builder = builder.rp_name("Clauderon");

        let webauthn = builder.build()?;

        Ok(Self {
            webauthn: Arc::new(webauthn),
        })
    }

    /// Start passkey registration for a new user
    ///
    /// # Arguments
    /// * `username` - Username for the new user
    /// * `user_id` - UUID for the new user
    ///
    /// # Returns
    /// A tuple of (creation options, registration state)
    ///
    /// # Errors
    /// Returns an error if the registration start fails
    pub fn start_registration(
        &self,
        username: &str,
        user_id: &Uuid,
    ) -> anyhow::Result<(CreationChallengeResponse, PasskeyRegistration)> {
        let (challenge, state) = self
            .webauthn
            .start_passkey_registration(*user_id, username, username, None)?;

        Ok((challenge, state))
    }

    /// Finish passkey registration
    ///
    /// # Arguments
    /// * `credential` - The credential response from the client
    /// * `state` - The registration state from start_registration
    ///
    /// # Returns
    /// The registered passkey
    ///
    /// # Errors
    /// Returns an error if the registration verification fails
    pub fn finish_registration(
        &self,
        credential: &RegisterPublicKeyCredential,
        state: &PasskeyRegistration,
    ) -> anyhow::Result<Passkey> {
        let passkey = self
            .webauthn
            .finish_passkey_registration(credential, state)?;

        Ok(passkey)
    }

    /// Start passkey authentication for an existing user
    ///
    /// # Arguments
    /// * `passkeys` - The user's registered passkeys
    ///
    /// # Returns
    /// A tuple of (request options, authentication state)
    ///
    /// # Errors
    /// Returns an error if the authentication start fails
    pub fn start_authentication(
        &self,
        passkeys: Vec<Passkey>,
    ) -> anyhow::Result<(RequestChallengeResponse, PasskeyAuthentication)> {
        let (challenge, state) = self.webauthn.start_passkey_authentication(&passkeys)?;

        Ok((challenge, state))
    }

    /// Finish passkey authentication
    ///
    /// # Arguments
    /// * `credential` - The credential response from the client
    /// * `state` - The authentication state from start_authentication
    ///
    /// # Returns
    /// The authentication result
    ///
    /// # Errors
    /// Returns an error if the authentication verification fails
    pub fn finish_authentication(
        &self,
        credential: &PublicKeyCredential,
        state: &PasskeyAuthentication,
    ) -> anyhow::Result<AuthenticationResult> {
        let result = self
            .webauthn
            .finish_passkey_authentication(credential, state)?;

        Ok(result)
    }
}
