import Foundation
@testable import GlanceApp

/// Reads secrets from `GLANCE_TEST_*` environment variables, falling back
/// to `BatchSecretProvider` if environment variables are not set.
final class EnvironmentSecretProvider: SecretProvider, @unchecked Sendable {
    // MARK: Lifecycle

    init() {
        // Map environment variable names to logical secret keys.
        let envMappings: [(envVar: String, key: String)] = [
            ("GLANCE_TEST_ARGOCD_AUTH_TOKEN", SecretRefs.argoCD),
            ("GLANCE_TEST_GRAFANA_API_KEY", SecretRefs.grafana),
            ("GLANCE_TEST_BUGSINK_TOKEN", SecretRefs.bugsink),
            ("GLANCE_TEST_GH_TOKEN", SecretRefs.github),
            ("GLANCE_TEST_BUILDKITE_API_TOKEN", SecretRefs.buildkite),
            ("GLANCE_TEST_CLOUDFLARE_TOKEN", SecretRefs.cloudflareToken),
            ("GLANCE_TEST_CLOUDFLARE_ACCOUNT_ID", SecretRefs.cloudflareAccountId),
            ("GLANCE_TEST_PAGERDUTY_TOKEN", SecretRefs.pagerDuty),
            ("GLANCE_TEST_ANTHROPIC_ADMIN_KEY", SecretRefs.anthropicAdmin),
            ("GLANCE_TEST_OPENAI_ADMIN_KEY", SecretRefs.openaiAdmin),
        ]

        var envSecrets: [String: String] = [:]
        for (envVar, key) in envMappings {
            if let value = ProcessInfo.processInfo.environment[envVar], !value.isEmpty {
                envSecrets[key] = value
            }
        }
        self.envSecrets = envSecrets
    }

    // MARK: Internal

    /// Load secrets from 1Password if environment variables are missing.
    func loadIfNeeded() async {
        guard self.envSecrets.count < SecretRefs.references.count else {
            return
        }
        let batch = BatchSecretProvider()
        await batch.loadAll()
        self.fallback = batch
    }

    func read(reference: String) async throws -> String {
        // Prefer environment variable.
        if let value = envSecrets[reference] {
            return value
        }
        // Fall back to BatchSecretProvider.
        guard let fallback else {
            throw SecretError.notLoaded(reference: reference)
        }
        return try await fallback.read(reference: reference)
    }

    // MARK: Private

    private let envSecrets: [String: String]
    private var fallback: BatchSecretProvider?
}
