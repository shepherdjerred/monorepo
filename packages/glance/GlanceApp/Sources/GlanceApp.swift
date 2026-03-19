import AppKit
import SwiftUI

@main
struct GlanceApp: App {
    // MARK: Lifecycle

    init() {
        let secrets = BatchSecretProvider()
        let providers = Self.createProviders(secrets: secrets)
        let state = AppState(providers: providers)
        _appState = State(initialValue: state)

        // Load all secrets in one op call, then start polling.
        Task {
            await secrets.loadAll()
            await state.startPolling()
        }
    }

    // MARK: Internal

    var body: some Scene {
        MenuBarExtra("Glance", systemImage: self.appState.menuBarIcon) {
            MenuBarPopover(appState: self.appState)
        }
        .menuBarExtraStyle(.window)

        Window("Homelab Dashboard", id: "dashboard") {
            DashboardWindow(appState: self.appState)
        }
        .defaultSize(width: 900, height: 600)
    }

    // MARK: Private

    @State private var appState: AppState

    private static func createProviders(secrets: BatchSecretProvider) -> [any ServiceProvider] {
        [
            AlertmanagerProvider(),
            ArgoCDProvider(secrets: secrets),
            BuildkiteProvider(secrets: secrets),
            BugsinkProvider(secrets: secrets),
            CertManagerProvider(),
            CloudflareProvider(secrets: secrets),
            GitHubProvider(secrets: secrets),
            GrafanaProvider(secrets: secrets),
            KubernetesProvider(),
            LokiProvider(),
            PagerDutyProvider(secrets: secrets),
            PrometheusProvider(),
            TalosProvider(),
            VeleroProvider(),
        ]
    }
}
