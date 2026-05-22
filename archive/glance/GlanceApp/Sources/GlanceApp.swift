import AppKit
import Foundation
import SwiftUI

@main
struct GlanceApp: App {
    // MARK: Lifecycle

    init() {
        let settings = GlanceSettings()
        let secrets = BatchSecretProvider()
        let providers = Self.createProviders(secrets: secrets)
        let notificationManager = NotificationManager()
        let spotlightIndexer = SpotlightIndexer()
        let state = AppState(
            providers: providers,
            notificationManager: notificationManager,
            settings: settings,
            spotlightIndexer: spotlightIndexer,
        )
        let networkMonitor = NetworkMonitor()
        _settings = State(initialValue: settings)
        _appState = State(initialValue: state)
        _networkMonitor = State(initialValue: networkMonitor)
        _notificationManager = State(initialValue: notificationManager)
        _spotlightIndexer = State(initialValue: spotlightIndexer)

        // Set up historical snapshot store.
        if let supportDir = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
        ).first {
            let dbPath = supportDir
                .appendingPathComponent("Glance", isDirectory: true)
                .appendingPathComponent("history.sqlite")
                .path
            state.snapshotStore = try? SnapshotStore(path: dbPath)
        }

        // Wire up App Intents state bridge.
        AppIntentStateProvider.shared.appState = state

        // Register notification categories and request authorization.
        notificationManager.registerCategories()
        Task {
            await notificationManager.requestAuthorization()
        }

        // Load all secrets in one op call, then start polling.
        Task {
            await secrets.loadAll()
            state.startPolling()

            // Start network monitoring, wiring reconnect to the coordinator.
            let coordinator = state.coordinator
            networkMonitor.start {
                Task {
                    await coordinator.resumePolling()
                }
            }
        }
    }

    // MARK: Internal

    var body: some Scene {
        MenuBarExtra("Glance", systemImage: self.appState.menuBarIcon) {
            MenuBarPopover(appState: self.appState)
        }
        .menuBarExtraStyle(.window)

        Window("Homelab Dashboard", id: "dashboard") {
            DashboardWindow(appState: self.appState, settings: self.settings)
                .sheet(isPresented: self.$showOnboarding) {
                    OnboardingView(settings: self.settings)
                        .interactiveDismissDisabled()
                }
                .sheet(isPresented: self.$showWhatsNew) {
                    WhatsNewView()
                }
                .onAppear {
                    if !self.settings.hasCompletedOnboarding {
                        self.showOnboarding = true
                    } else if WhatsNewView.shouldShow {
                        self.showWhatsNew = true
                    }
                }
                .onReceive(
                    NotificationCenter.default.publisher(for: .glanceOpenDashboard),
                ) { _ in
                    NSApplication.shared.setActivationPolicy(.regular)
                    NSApplication.shared.activate()
                }
                .onContinueUserActivity(
                    SpotlightIndexer.activityType,
                ) { activity in
                    if let serviceId = SpotlightIndexer.serviceId(from: activity) {
                        self.appState.selectedServiceId = serviceId
                        NSApplication.shared.setActivationPolicy(.regular)
                        NSApplication.shared.activate()
                    }
                }
        }
        .defaultSize(width: 900, height: 600)
        .defaultLaunchBehavior(.suppressed)
        .windowToolbarStyle(.unified)
        .windowResizability(.contentMinSize)
        .commands {
            AppCommands()
        }

        Settings {
            SettingsView(settings: self.settings)
        }
    }

    // MARK: Private

    @State private var settings: GlanceSettings
    @State private var appState: AppState
    @State private var networkMonitor: NetworkMonitor
    @State private var notificationManager: NotificationManager
    @State private var spotlightIndexer: SpotlightIndexer
    @State private var showOnboarding = false
    @State private var showWhatsNew = false

    private static func createProviders(secrets: BatchSecretProvider) -> [any ServiceProvider] {
        [
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
    }
}
