import QuotaBarCore
import SwiftUI

@MainActor
@main
struct QuotaBarApp: App {
  @State private var model: QuotaBarModel
  @State private var launchAtLogin: LaunchAtLoginController
  private let manualCredentials: ManualCredentialStore
  private let startupError: String?

  init() {
    let settings = AppSettings()
    let manualCredentials = ManualCredentialStore()
    let credentials = CompositeCredentialStore(
      manual: manualCredentials,
      local: LocalCredentialStore()
    )
    let providers: [any UsageProvider]
    let startupError: String?
    do {
      providers = try Providers.live(credentials: credentials)
      startupError = nil
    } catch {
      providers = []
      startupError = "QuotaBar could not configure its provider URLs."
    }
    self.manualCredentials = manualCredentials
    self.startupError = startupError
    let model = QuotaBarModel(providers: providers, settings: settings)
    _model = State(initialValue: model)
    _launchAtLogin = State(initialValue: LaunchAtLoginController())
    model.startPolling()
  }

  var body: some Scene {
    MenuBarExtra {
      MenuBarView(model: model, startupError: startupError)
    } label: {
      Label("QuotaBar", systemImage: model.overallStatus.symbolName)
        .symbolRenderingMode(.hierarchical)
        .foregroundStyle(model.overallStatus.color)
    }
    .menuBarExtraStyle(.window)

    Settings {
      SettingsView(
        model: model,
        manualCredentials: manualCredentials,
        launchAtLogin: launchAtLogin
      )
    }
  }
}
