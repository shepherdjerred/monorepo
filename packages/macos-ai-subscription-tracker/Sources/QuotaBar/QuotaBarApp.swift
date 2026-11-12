import QuotaBarCore
import SwiftUI

@MainActor
@main
struct QuotaBarApp: App {
  @State private var model: QuotaBarModel
  @State private var apiModel: APIPlatformModel
  @State private var launchAtLogin: LaunchAtLoginController
  @State private var sessionsModel = SessionsModel()
  private let manualCredentials: ManualCredentialStore
  private let apiCredentials: APIPlatformCredentialStore
  private let startupError: String?

  init() {
    let settings = AppSettings()
    let manualCredentials = ManualCredentialStore()
    let credentials = CompositeCredentialStore(
      manual: manualCredentials,
      local: LocalCredentialStore()
    )
    let providers: [any UsageProvider]
    let providerFactory: (Set<ProviderID>) throws -> [any UsageProvider] = { providerIDs in
      try Providers.live(credentials: credentials, providerIDs: providerIDs)
    }
    let startupError: String?
    do {
      providers = try providerFactory(settings.visibleProviderIDs)
      startupError = nil
    } catch {
      providers = []
      startupError = "Brim could not configure its provider URLs."
    }
    self.manualCredentials = manualCredentials
    let apiCredentials = APIPlatformCredentialStore()
    self.apiCredentials = apiCredentials
    self.startupError = startupError
    let model = QuotaBarModel(
      providers: providers,
      settings: settings,
      store: JSONSnapshotStore(),
      historyStore: JSONUsageHistoryStore(),
      providerFactory: providerFactory
    )
    let apiModel = APIPlatformModel(settings: settings, credentials: apiCredentials)
    _model = State(initialValue: model)
    _apiModel = State(initialValue: apiModel)
    _launchAtLogin = State(initialValue: LaunchAtLoginController())
    model.startPolling()
    apiModel.startPolling()
  }

  var body: some Scene {
    MenuBarExtra {
      MenuBarView(model: model, apiModel: apiModel, startupError: startupError)
    } label: {
      BrimMenuBarLabel(status: model.overallStatus)
    }
    .menuBarExtraStyle(.window)

    Window("Sessions", id: SessionsWindow.id) {
      SessionsWindow(model: sessionsModel)
    }
    .defaultSize(width: 1_240, height: 780)
    // A login-item menu-bar app opens this window only from "Browse sessions".
    .defaultLaunchBehavior(.suppressed)
    .restorationBehavior(.disabled)

    Settings {
      SettingsView(
        model: model,
        apiModel: apiModel,
        manualCredentials: manualCredentials,
        apiCredentials: apiCredentials,
        launchAtLogin: launchAtLogin
      )
    }
  }
}
