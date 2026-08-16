import AppKit
import QuotaBarCore
import SwiftUI

struct SettingsView: View {
  @Bindable var model: QuotaBarModel
  @Bindable var apiModel: APIPlatformModel
  let manualCredentials: ManualCredentialStore
  let openRouterCredentials: OpenRouterCredentialStore
  @Bindable var launchAtLogin: LaunchAtLoginController
  @State private var drafts: [ProviderID: String] = [:]
  @State private var overriddenProviders: Set<ProviderID> = []
  @State private var credentialMessage: String?
  @State private var openRouterDraft = ""
  @State private var hasOpenRouterCredential = false
  @State private var openRouterCredentialMessage: String?

  var body: some View {
    Form {
      providerSection
      refreshSection
      loginSection
      credentialSection
      openRouterCredentialSection
    }
    .formStyle(.grouped)
    .frame(width: 520, height: 680)
    .task { await loadCredentialStatus() }
    .onAppear { launchAtLogin.refresh() }
  }

  private var openRouterCredentialSection: some View {
    Section("API platform") {
      Text(
        "Enter an OpenRouter Management API key to read credits, workspaces, and API-key usage. "
          + "Brim only sends read-only requests; the key remains in your login Keychain."
      )
      .font(.caption)
      .foregroundStyle(.secondary)
      if let url = URL(string: "https://openrouter.ai/settings/management-keys") {
        Link("OpenRouter Management API keys", destination: url)
      }
      VStack(alignment: .leading, spacing: 5) {
        HStack {
          SecureField("OpenRouter Management API key", text: $openRouterDraft)
          Button("Save") { saveOpenRouterCredential() }
            .disabled(openRouterDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
          Button("Remove") { removeOpenRouterCredential() }
            .disabled(!hasOpenRouterCredential)
        }
        if hasOpenRouterCredential {
          Label("Management API key saved in Keychain", systemImage: "key.fill")
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
      }
      if let openRouterCredentialMessage {
        Text(openRouterCredentialMessage)
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
  }

  private var providerSection: some View {
    Section("Providers") {
      ForEach(ProviderID.allCases) { provider in
        HStack {
          Toggle(provider.displayName, isOn: providerBinding(provider))
          Spacer()
          if let url = provider.usageURL { Link("Usage", destination: url) }
        }
      }
      if let error = model.settings.validationErrorMessage {
        Label(error, systemImage: "exclamationmark.triangle")
          .foregroundStyle(.red)
      }
    }
  }

  private var refreshSection: some View {
    Section("Refresh") {
      Picker("Polling interval", selection: pollingBinding) {
        Text("1 minute").tag(TimeInterval(60))
        Text("5 minutes").tag(TimeInterval(300))
        Text("15 minutes").tag(TimeInterval(900))
        Text("30 minutes").tag(TimeInterval(1_800))
      }
    }
  }

  private var loginSection: some View {
    Section("Login") {
      Toggle("Launch Brim at login", isOn: loginBinding)
        .disabled(launchAtLogin.status == .unavailable)
      if launchAtLogin.status == .requiresApproval {
        HStack {
          Label("Approval required in Login Items", systemImage: "gear.badge")
          Spacer()
          Button("Open Settings") { openLoginItemsSettings() }
        }
      }
      if let error = launchAtLogin.errorMessage {
        Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.red)
      }
    }
  }

  private var credentialSection: some View {
    Section("Credential overrides") {
      Text(
        "Optional. Stored only in your login Keychain; local CLI and OpenCode credentials remain unchanged."
      )
      .font(.caption)
      .foregroundStyle(.secondary)
      ForEach(ProviderID.allCases) { provider in
        VStack(alignment: .leading, spacing: 5) {
          HStack {
            SecureField("\(provider.displayName) token", text: draftBinding(provider))
            Button("Save") { saveCredential(provider) }
              .disabled(drafts[provider, default: ""].trimmingCharacters(in: .whitespaces).isEmpty)
            Button("Remove") { removeCredential(provider) }
              .disabled(!overriddenProviders.contains(provider))
          }
          if overriddenProviders.contains(provider) {
            Label("Keychain override saved", systemImage: "key.fill")
              .font(.caption2).foregroundStyle(.secondary)
          }
        }
      }
      if let credentialMessage {
        Text(credentialMessage).font(.caption).foregroundStyle(.secondary)
      }
    }
  }

  private func providerBinding(_ provider: ProviderID) -> Binding<Bool> {
    Binding(
      get: { model.settings.enabledProviders.contains(provider) },
      set: { model.setProvider(provider, enabled: $0) }
    )
  }

  private var pollingBinding: Binding<TimeInterval> {
    Binding(
      get: { model.settings.pollingInterval },
      set: { model.updatePollingInterval($0) }
    )
  }

  private var loginBinding: Binding<Bool> {
    Binding(
      get: { launchAtLogin.isEnabled },
      set: { launchAtLogin.setEnabled($0) }
    )
  }

  private func draftBinding(_ provider: ProviderID) -> Binding<String> {
    Binding(
      get: { drafts[provider, default: ""] },
      set: { drafts[provider] = $0 }
    )
  }

  private func saveCredential(_ provider: ProviderID) {
    let token = drafts[provider, default: ""]
    Task {
      do {
        try await manualCredentials.save(token, for: provider)
        overriddenProviders.insert(provider)
        drafts[provider] = ""
        credentialMessage = "Saved \(provider.displayName) override."
        await model.handleCredentialChange(for: provider)
      } catch {
        credentialMessage = error.localizedDescription
      }
    }
  }

  private func removeCredential(_ provider: ProviderID) {
    Task {
      do {
        try await manualCredentials.remove(for: provider)
        overriddenProviders.remove(provider)
        credentialMessage = "Removed \(provider.displayName) override."
        await model.handleCredentialChange(for: provider)
      } catch {
        credentialMessage = error.localizedDescription
      }
    }
  }

  private func loadCredentialStatus() async {
    for provider in ProviderID.allCases {
      do {
        if try await manualCredentials.credentialIfPresent(for: provider) != nil {
          overriddenProviders.insert(provider)
        }
      } catch {
        credentialMessage = "Keychain status unavailable."
      }
    }
    do {
      hasOpenRouterCredential = try await openRouterCredentials.token() != nil
    } catch {
      openRouterCredentialMessage = "OpenRouter Keychain status unavailable."
    }
  }

  private func saveOpenRouterCredential() {
    let token = openRouterDraft
    Task {
      do {
        try await openRouterCredentials.save(token)
        hasOpenRouterCredential = true
        openRouterDraft = ""
        openRouterCredentialMessage = "Saved OpenRouter Management API key."
        await apiModel.handleCredentialChange()
      } catch {
        openRouterCredentialMessage = error.localizedDescription
      }
    }
  }

  private func removeOpenRouterCredential() {
    Task {
      do {
        try await openRouterCredentials.remove()
        hasOpenRouterCredential = false
        openRouterCredentialMessage = "Removed OpenRouter Management API key."
        await apiModel.handleCredentialChange()
      } catch {
        openRouterCredentialMessage = error.localizedDescription
      }
    }
  }

  private func openLoginItemsSettings() {
    guard
      let url = URL(
        string: "x-apple.systempreferences:com.apple.LoginItems-Settings.extension"
      )
    else { return }
    NSWorkspace.shared.open(url)
  }
}
