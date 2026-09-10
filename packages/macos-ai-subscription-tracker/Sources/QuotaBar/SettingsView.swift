import AppKit
import QuotaBarCore
import SwiftUI

struct SettingsView: View {
  @Bindable var model: QuotaBarModel
  @Bindable var apiModel: APIPlatformModel
  let manualCredentials: ManualCredentialStore
  let apiCredentials: APIPlatformCredentialStore
  @Bindable var launchAtLogin: LaunchAtLoginController
  @State private var drafts: [ProviderID: String] = [:]
  @State private var overriddenProviders: Set<ProviderID> = []
  @State private var credentialMessage: String?
  @State private var apiDrafts: [APIPlatformID: String] = [:]
  @State private var apiHasCredential: Set<APIPlatformID> = []
  @State private var apiMessages: [APIPlatformID: String] = [:]

  var body: some View {
    Form {
      providerSection
      if !ProviderID.legacy.isEmpty {
        advancedSection
      }
      refreshSection
      loginSection
      credentialSection
      apiCredentialSection
    }
    .formStyle(.grouped)
    .frame(width: 520, height: 780)
    .task { await loadCredentialStatus() }
    .onChange(of: model.settings.visibleProviderIDs) { _, _ in
      Task { await loadCredentialStatus() }
    }
    .onAppear { launchAtLogin.refresh() }
  }

  private var apiCredentialSection: some View {
    Section("API platforms") {
      Text(
        "Enter read-only admin or management keys to report API spend. Keys stay in your login Keychain. "
          + "Brim never creates, rotates, or deletes provider keys."
      )
      .font(.caption)
      .foregroundStyle(.secondary)
      ForEach(APIPlatformID.allCases) { platform in
        VStack(alignment: .leading, spacing: 5) {
          if let url = platform.credentialHelpURL {
            Link("\(platform.displayName) keys", destination: url)
          }
          HStack {
            SecureField(platform.credentialLabel, text: apiDraftBinding(platform))
            Button("Save") { saveAPICredential(platform) }
              .disabled(
                apiDrafts[platform, default: ""].trimmingCharacters(in: .whitespacesAndNewlines)
                  .isEmpty)
            Button("Remove") { removeAPICredential(platform) }
              .disabled(!apiHasCredential.contains(platform))
          }
          if apiHasCredential.contains(platform) {
            Label("Key saved in Keychain", systemImage: "key.fill")
              .font(.caption2)
              .foregroundStyle(.secondary)
          }
          if let message = apiMessages[platform] {
            Text(message)
              .font(.caption)
              .foregroundStyle(.secondary)
          }
        }
      }
    }
  }

  private var providerSection: some View {
    Section("Providers") {
      ForEach(ProviderID.allCases.filter(model.settings.visibleProviderIDs.contains)) { provider in
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

  private var advancedSection: some View {
    Section("Advanced") {
      Toggle("Show legacy providers", isOn: legacyProviderBinding)
      Text(
        "These providers use unsupported subscription surfaces. They remain off unless you opt in."
      )
      .font(.caption)
      .foregroundStyle(.secondary)
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
        "Optional. Stored only in your login Keychain; local CLI and OpenCode credentials remain unchanged. "
          + "Google Antigravity and Cursor reuse their own local app sign-ins and cannot be overridden."
      )
      .font(.caption)
      .foregroundStyle(.secondary)
      ForEach(
        ProviderID.allCases.filter {
          model.settings.visibleProviderIDs.contains($0) && $0.supportsManualCredentialOverride
        }
      ) { provider in
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

  private var legacyProviderBinding: Binding<Bool> {
    Binding(
      get: { model.settings.showsLegacyProviders },
      set: { model.setShowsLegacyProviders($0) }
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

  private func apiDraftBinding(_ platform: APIPlatformID) -> Binding<String> {
    Binding(
      get: { apiDrafts[platform, default: ""] },
      set: { apiDrafts[platform] = $0 }
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
    for provider in model.settings.visibleProviderIDs
    where provider.supportsManualCredentialOverride {
      do {
        if try await manualCredentials.credentialIfPresent(for: provider) != nil {
          overriddenProviders.insert(provider)
        }
      } catch {
        credentialMessage = "Keychain status unavailable."
      }
    }
    for platform in APIPlatformID.allCases {
      do {
        if try await apiCredentials.token(for: platform) != nil {
          apiHasCredential.insert(platform)
        }
      } catch {
        apiMessages[platform] = "\(platform.displayName) Keychain status unavailable."
      }
    }
  }

  private func saveAPICredential(_ platform: APIPlatformID) {
    let token = apiDrafts[platform, default: ""]
    Task {
      do {
        try await apiCredentials.save(token, for: platform)
        apiHasCredential.insert(platform)
        apiDrafts[platform] = ""
        apiMessages[platform] = "Saved \(platform.credentialLabel)."
        await apiModel.handleCredentialChange(for: platform)
      } catch {
        apiMessages[platform] = error.localizedDescription
      }
    }
  }

  private func removeAPICredential(_ platform: APIPlatformID) {
    Task {
      do {
        try await apiCredentials.remove(for: platform)
        apiHasCredential.remove(platform)
        apiMessages[platform] = "Removed \(platform.credentialLabel)."
        await apiModel.handleCredentialChange(for: platform)
      } catch {
        apiMessages[platform] = error.localizedDescription
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
