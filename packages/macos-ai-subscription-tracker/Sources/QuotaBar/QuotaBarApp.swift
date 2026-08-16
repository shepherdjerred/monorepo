import QuotaBarCore
import SwiftUI

@MainActor
@main
struct QuotaBarApp: App {
  @State private var model: QuotaBarModel
  @State private var apiModel: APIPlatformModel
  @State private var launchAtLogin: LaunchAtLoginController
  private let manualCredentials: ManualCredentialStore
  private let openRouterCredentials: OpenRouterCredentialStore
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
      startupError = "Brim could not configure its provider URLs."
    }
    self.manualCredentials = manualCredentials
    let openRouterCredentials = OpenRouterCredentialStore()
    self.openRouterCredentials = openRouterCredentials
    self.startupError = startupError
    let model = QuotaBarModel(providers: providers, settings: settings)
    let apiModel = APIPlatformModel(settings: settings, credentials: openRouterCredentials)
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

    Settings {
      SettingsView(
        model: model,
        apiModel: apiModel,
        manualCredentials: manualCredentials,
        openRouterCredentials: openRouterCredentials,
        launchAtLogin: launchAtLogin
      )
    }
  }
}
