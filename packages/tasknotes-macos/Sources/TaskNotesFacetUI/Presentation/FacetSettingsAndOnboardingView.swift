import Foundation
public import SwiftUI
import TaskNotesKit

/// Facet Server Connection, Sensory Feedback, and Appearance settings shared across macOS and iOS.
public struct FacetSettingsAndOnboardingView: View {
    private let store: FacetStore
    private let embeddedInTab: Bool
    @Environment(\.dismiss) private var dismiss

    @State private var urlInput: String
    @State private var tokenInput: String = ""
    @State private var statusFeedback: String?

    public init(store: FacetStore, embeddedInTab: Bool = false) {
        self.store = store
        self.embeddedInTab = embeddedInTab
        _urlInput = State(initialValue: store.serverURLString)
    }

    public var body: some View {
        Form {
            SwiftUI.Section("Facet Sync Server") {
                TextField("Server URL", text: $urlInput)
                    .autocorrectionDisabled()
                    #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                    #endif
                    .accessibilityIdentifier(AccessibilityIdentifier.settingsServerURL)

                SecureField(
                    store.hasConfiguredToken
                        ? "API Bearer Token (saved in Keychain — enter to replace)"
                        : "API Bearer Token",
                    text: $tokenInput
                )
                .accessibilityIdentifier(AccessibilityIdentifier.settingsServerToken)

                HStack(spacing: 10) {
                    Button(store.hasConfiguredToken ? "Save & Sync Now" : "Connect Server") {
                        _Concurrency.Task {
                            let ok = await store.saveConnection(
                                urlString: urlInput,
                                apiToken: tokenInput
                            )
                            if ok {
                                tokenInput = ""
                                statusFeedback = "Connected and synced."
                            } else {
                                statusFeedback = nil
                            }
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(store.isSyncing)
                    .accessibilityIdentifier(AccessibilityIdentifier.settingsConnect)

                    if store.hasConfiguredToken {
                        Button("Sync Now") {
                            _Concurrency.Task { await store.syncNow() }
                        }
                        .disabled(store.isSyncing)
                        .accessibilityIdentifier(AccessibilityIdentifier.settingsSyncNow)

                        Button("Disconnect", role: .destructive) {
                            store.disconnectServer()
                            statusFeedback = "Cleared stored token from Keychain."
                        }
                    }
                }

                connectionStatusRow
            }

            SwiftUI.Section("Sensory Feedback") {
                Toggle(
                    "Sound effects",
                    isOn: Binding(
                        get: { store.feedback.soundsEnabled },
                        set: { store.feedback.setSoundsEnabled($0) }
                    )
                )
                Toggle(
                    "Haptic feedback",
                    isOn: Binding(
                        get: { store.feedback.hapticsEnabled },
                        set: { store.feedback.setHapticsEnabled($0) }
                    )
                )
                if let prefError = store.feedback.preferenceError {
                    Label(prefError, systemImage: "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }

            #if os(iOS)
                SwiftUI.Section("Appearance") {
                    FacetAppearanceSettings()
                }
            #endif
        }
        .formStyle(.grouped)
        .navigationTitle("Settings")
        .toolbar {
            if !embeddedInTab {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .accessibilityIdentifier(AccessibilityIdentifier.settings)
    }

    @ViewBuilder
    private var connectionStatusRow: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Circle()
                    .fill(
                        store.hasConfiguredToken
                            ? (store.effectiveError == nil ? Color.green : Color.red)
                            : Color.orange
                    )
                    .frame(width: 8, height: 8)
                Text(
                    store.hasConfiguredToken
                        ? (store.isSyncing ? "Syncing…" : "Connected to \(store.serverURLString)")
                        : "Offline-only mode (no API token in Keychain)"
                )
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            Text(
                "Pending outbox commands: \(store.pendingOutboxCount)"
                    + (store.syncToken.map { " · Cursor: \($0)" } ?? "")
            )
            .font(.caption2.monospacedDigit())
            .foregroundStyle(.secondary)

            if let errorText = store.effectiveError {
                Text(errorText)
                    .font(.caption)
                    .foregroundStyle(.red)
            } else if let statusFeedback {
                Text(statusFeedback)
                    .font(.caption)
                    .foregroundStyle(.green)
            }
        }
    }
}
