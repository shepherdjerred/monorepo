import Foundation
@testable import GlanceApp
import Testing

// MARK: - RealProviderTests

/// Integration tests that exercise real provider `fetchStatus()` against live APIs.
///
/// These tests are gated by the `GLANCE_INTEGRATION` environment variable and require
/// either `GLANCE_TEST_*` env vars or 1Password CLI access for secrets.
@Suite(.tags(.integration))
struct RealProviderTests {
    // MARK: Internal

    // MARK: - Secret-Free Providers (kubectl/CLI based)

    @Test(.enabled(if: integrationEnabled))
    func `kubernetes provider fetches real status`() async {
        let provider = KubernetesProvider()
        let snapshot = await provider.fetchStatus()
        self.validateSnapshot(snapshot, id: "kubernetes")
    }

    @Test(.enabled(if: integrationEnabled))
    func `alertmanager provider fetches real status`() async {
        let provider = AlertmanagerProvider()
        let snapshot = await provider.fetchStatus()
        self.validateSnapshot(snapshot, id: "alertmanager")
    }

    @Test(.enabled(if: integrationEnabled))
    func `prometheus provider fetches real status`() async {
        let provider = PrometheusProvider()
        let snapshot = await provider.fetchStatus()
        self.validateSnapshot(snapshot, id: "prometheus")
    }

    @Test(.enabled(if: integrationEnabled))
    func `loki provider fetches real status`() async {
        let provider = LokiProvider()
        let snapshot = await provider.fetchStatus()
        self.validateSnapshot(snapshot, id: "loki")
    }

    @Test(.enabled(if: integrationEnabled))
    func `talos provider fetches real status`() async {
        let provider = TalosProvider()
        let snapshot = await provider.fetchStatus()
        self.validateSnapshot(snapshot, id: "talos")
    }

    @Test(.enabled(if: integrationEnabled))
    func `velero provider fetches real status`() async {
        let provider = VeleroProvider()
        let snapshot = await provider.fetchStatus()
        self.validateSnapshot(snapshot, id: "velero")
    }

    @Test(.enabled(if: integrationEnabled))
    func `cert manager provider fetches real status`() async {
        let provider = CertManagerProvider()
        let snapshot = await provider.fetchStatus()
        self.validateSnapshot(snapshot, id: "cert-manager")
    }

    @Test(.enabled(if: integrationEnabled))
    func `claude code provider fetches real status`() async {
        let provider = ClaudeCodeProvider()
        let snapshot = await provider.fetchStatus()
        self.validateSnapshot(snapshot, id: "claude-code")
    }

    @Test(.enabled(if: integrationEnabled))
    func `codex provider fetches real status`() async {
        let provider = CodexProvider()
        let snapshot = await provider.fetchStatus()
        self.validateSnapshot(snapshot, id: "codex")
    }

    // MARK: - Secret-Dependent Providers

    @Test(.enabled(if: integrationEnabled))
    func `argo CD provider fetches real status`() async {
        let secrets = await loadSecrets()
        let provider = ArgoCDProvider(secrets: secrets)
        let snapshot = await provider.fetchStatus()
        self.validateSnapshot(snapshot, id: "argocd")
    }

    @Test(.enabled(if: integrationEnabled))
    func `grafana provider fetches real status`() async {
        let secrets = await loadSecrets()
        let provider = GrafanaProvider(secrets: secrets)
        let snapshot = await provider.fetchStatus()
        self.validateSnapshot(snapshot, id: "grafana")
    }

    @Test(.enabled(if: integrationEnabled))
    func `bugsink provider fetches real status`() async {
        let secrets = await loadSecrets()
        let provider = BugsinkProvider(secrets: secrets)
        let snapshot = await provider.fetchStatus()
        self.validateSnapshot(snapshot, id: "bugsink")
    }

    @Test(.enabled(if: integrationEnabled))
    func `git hub provider fetches real status`() async {
        let secrets = await loadSecrets()
        let provider = GitHubProvider(secrets: secrets)
        let snapshot = await provider.fetchStatus()
        self.validateSnapshot(snapshot, id: "github")
    }

    @Test(.enabled(if: integrationEnabled))
    func `buildkite provider fetches real status`() async {
        let secrets = await loadSecrets()
        let provider = BuildkiteProvider(secrets: secrets)
        let snapshot = await provider.fetchStatus()
        self.validateSnapshot(snapshot, id: "buildkite")
    }

    @Test(.enabled(if: integrationEnabled))
    func `cloudflare provider fetches real status`() async {
        let secrets = await loadSecrets()
        let provider = CloudflareProvider(secrets: secrets)
        let snapshot = await provider.fetchStatus()
        self.validateSnapshot(snapshot, id: "cloudflare")
    }

    @Test(.enabled(if: integrationEnabled))
    func `pager duty provider fetches real status`() async {
        let secrets = await loadSecrets()
        let provider = PagerDutyProvider(secrets: secrets)
        let snapshot = await provider.fetchStatus()
        self.validateSnapshot(snapshot, id: "pagerduty")
    }

    @Test(.enabled(if: integrationEnabled))
    func `anthropic provider fetches real status`() async {
        let secrets = await loadSecrets()
        let provider = AnthropicProvider(secrets: secrets)
        let snapshot = await provider.fetchStatus()
        self.validateSnapshot(snapshot, id: "anthropic")
    }

    @Test(.enabled(if: integrationEnabled))
    func `open AI provider fetches real status`() async {
        let secrets = await loadSecrets()
        let provider = OpenAIProvider(secrets: secrets)
        let snapshot = await provider.fetchStatus()
        self.validateSnapshot(snapshot, id: "openai")
    }

    // MARK: - Full Refresh

    @Test(.enabled(if: integrationEnabled))
    @MainActor
    func `full refresh returns snapshots for all providers`() async {
        let secrets = EnvironmentSecretProvider()
        await secrets.loadIfNeeded()

        let providers: [any ServiceProvider] = [
            AlertmanagerProvider(),
            AnthropicProvider(secrets: secrets),
            ArgoCDProvider(secrets: secrets),
            BuildkiteProvider(secrets: secrets),
            BugsinkProvider(secrets: secrets),
            CertManagerProvider(),
            ClaudeCodeProvider(),
            CloudflareProvider(secrets: secrets),
            CodexProvider(),
            GitHubProvider(secrets: secrets),
            GrafanaProvider(secrets: secrets),
            KubernetesProvider(),
            LokiProvider(),
            OpenAIProvider(secrets: secrets),
            PagerDutyProvider(secrets: secrets),
            PrometheusProvider(),
            TalosProvider(),
            VeleroProvider(),
        ]

        let state = AppState(providers: providers)
        await state.refreshNow()

        #expect(state.snapshots.count == providers.count)
        for snapshot in state.snapshots {
            #expect(
                !snapshot.summary.isEmpty,
                "Snapshot for \(snapshot.id) has empty summary",
            )
            #expect(
                ServiceStatus.allCases.contains(snapshot.status),
                "Snapshot for \(snapshot.id) has invalid status",
            )
        }
    }

    // MARK: Private

    // MARK: - Helpers

    private func loadSecrets() async -> EnvironmentSecretProvider {
        let secrets = EnvironmentSecretProvider()
        await secrets.loadIfNeeded()
        return secrets
    }

    private func validateSnapshot(
        _ snapshot: ServiceSnapshot,
        id: String,
    ) {
        #expect(
            snapshot.id == id,
            "Snapshot ID mismatch: expected \(id), got \(snapshot.id)",
        )
        #expect(
            !snapshot.summary.isEmpty,
            "Snapshot summary for \(id) should not be empty",
        )
        #expect(
            !snapshot.displayName.isEmpty,
            "Snapshot displayName for \(id) should not be empty",
        )
        #expect(
            !snapshot.iconName.isEmpty,
            "Snapshot iconName for \(id) should not be empty",
        )
        #expect(
            ServiceStatus.allCases.contains(snapshot.status),
            "Snapshot status for \(id) is not a valid ServiceStatus case",
        )
    }
}
