import SwiftUI
import TaskNotesKit

#if DEBUG && os(iOS) && targetEnvironment(simulator)
    import UIKit
#endif

struct FacetAccountForm: View {
    @Bindable var store: FacetStore
    var ownsPresentation: @MainActor () -> Bool = { true }
    var didAppear: (@MainActor () -> Void)?
    var didDisappear: (@MainActor () -> Void)?
    @State private var email = ""
    @State private var password = ""
    @State private var code = ""
    @State private var vaultPassword = ""
    @State private var submitting = false
    @State private var request: _Concurrency.Task<Void, Never>?
    @State private var requestID: UUID?
    #if DEBUG && os(iOS) && targetEnvironment(simulator)
        @State private var acceptanceInput: FacetAcceptanceAccountInput?
        @State private var acceptanceMount: UUID?
        // Retain confinement until these State values are disposed, even after peer teardown.
        @State private var acceptanceValuesConfined = false
    #endif
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    private var accountBusy: Bool { submitting || store.accountPresentation.isBusy }
    private var busy: Bool { accountBusy || store.isLoading }

    var body: some View {
        NavigationStack {
            Form {
                if store.accountPresentation.stage != .vaults && store.remoteVaults.isEmpty {
                    Section("Obsidian account") {
                        TextField("Email", text: $email).textContentType(.emailAddress)
                            .accessibilityIdentifier("facet.account.email")
                            #if DEBUG && os(iOS) && targetEnvironment(simulator)
                                .accessibilityValue(
                                    Text(email.isEmpty ? "Empty" : "Entered"),
                                    isEnabled: acceptanceValuesConfined)
                            #endif
                            #if os(iOS)
                                .keyboardType(.emailAddress)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                            #endif
                        SecureField("Password", text: $password).textContentType(.password)
                            .accessibilityIdentifier("facet.account.password")
                        if store.accountNeedsCode {
                            TextField("Verification code", text: $code).textContentType(
                                .oneTimeCode
                            )
                            .accessibilityIdentifier("facet.account.code")
                            #if DEBUG && os(iOS) && targetEnvironment(simulator)
                                .accessibilityValue(
                                    Text(code.isEmpty ? "Empty" : "Entered"),
                                    isEnabled: acceptanceValuesConfined)
                            #endif
                            #if os(iOS)
                                .keyboardType(.numberPad)
                            #endif
                        }
                        Button {
                            let submittedEmail = email
                            let submittedPassword = password
                            let submittedCode = code
                            begin { requestID in
                                await store.signIn(
                                    email: submittedEmail, password: submittedPassword,
                                    code: submittedCode, requestID: requestID)
                                code = ""
                                if store.accountPresentation.stage == .vaults { password = "" }
                            }
                        } label: {
                            if accountBusy {
                                ProgressView("Signing in…")
                            } else if store.isLoading {
                                ProgressView("Preparing Facet…")
                            } else {
                                Text("Sign in")
                            }
                        }.disabled(busy || email.isEmpty || password.isEmpty)
                            .accessibilityIdentifier("facet.account.signin")
                    }
                    .disabled(busy)
                } else {
                    Section("Your Sync vaults") {
                        if store.remoteVaults.isEmpty {
                            Label("No Sync vaults yet", systemImage: "folder.badge.questionmark")
                            Button("Sign in again to refresh vaults") {
                                store.resetAccountChallenge()
                            }.disabled(busy)
                        } else {
                            SecureField("Vault encryption password", text: $vaultPassword)
                                .accessibilityIdentifier("facet.account.vault-password")
                            ForEach(store.remoteVaults) { vault in
                                ForEach(existingProfiles(vault.id)) { profile in
                                    Button("Reconnect \(profile.name)") {
                                        let submittedPassword = vault.managed ? nil : vaultPassword
                                        begin { requestID in
                                            await store.connectRemote(
                                                vault, password: submittedPassword,
                                                existingProfileID: profile.id, requestID: requestID)
                                        }
                                    }.disabled(
                                        busy || (!vault.managed && vaultPassword.isEmpty)
                                    )
                                    .accessibilityIdentifier(
                                        "facet.account.reconnect.\(profile.id)")
                                }
                                Button(vault.name) {
                                    let submittedPassword = vault.managed ? nil : vaultPassword
                                    begin { requestID in
                                        await store.connectRemote(
                                            vault, password: submittedPassword, requestID: requestID
                                        )
                                    }
                                }.disabled(busy || (!vault.managed && vaultPassword.isEmpty))
                                    .accessibilityIdentifier("facet.account.vault.\(vault.id)")
                            }
                            Text(
                                "Facet downloads an independent copy of this vault, including its attachments. "
                                    + "Obsidian settings are read as data."
                            )
                            .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .disabled(busy)
                }
                if let operation = store.accountPresentation.operation {
                    Section {
                        ProgressView(operation.message).accessibilityIdentifier(
                            "facet.account.progress")
                    }
                }
                if let message = store.accountPresentation.notice {
                    Section { Text(message).accessibilityIdentifier("facet.account.notice") }
                }
                if let failure = store.accountPresentation.error {
                    Section {
                        Label(failure, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("facet.account.error")
                        if store.accountPresentation.restoreFailed {
                            Button("Retry session restoration") {
                                begin { await store.restoreAccountSession(requestID: $0) }
                            }
                            .disabled(busy)
                            .accessibilityIdentifier("facet.account.restore.retry")
                        }
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Obsidian Sync")
            .task(id: scenePhase) {
                await store.start()
                if scenePhase == .active, ownsPresentation(),
                    !store.accountPresentation.restoreAttempted
                {
                    await store.restoreAccountSession()
                }
            }
            .toolbar {
                Button(busy ? "Cancel" : "Done") {
                    cancel()
                    dismiss()
                }
                .accessibilityIdentifier("facet.account.done")
            }
            .onChange(of: email) {
                guard ownsPresentation() else { return }
                store.accountCredentialsChanged()
                code = ""
            }
            .onChange(of: password) {
                guard ownsPresentation() else { return }
                store.accountCredentialsChanged()
                code = ""
            }
            .onChange(of: scenePhase) {
                #if DEBUG && os(iOS) && targetEnvironment(simulator)
                    if scenePhase != .active {
                        acceptanceMount = nil
                        acceptanceInput?.stop()
                        acceptanceInput = nil
                    }
                #endif
                if scenePhase == .background {
                    cancel()
                }
            }
            .onAppear {
                didAppear?()
                #if DEBUG && os(iOS) && targetEnvironment(simulator)
                    let mount = UUID()
                    acceptanceInput?.stop()
                    acceptanceMount = mount
                    do {
                        acceptanceInput = try FacetAcceptanceAccountInput.start(
                            configuration: store.acceptanceConfiguration,
                            fixtureIdentity: store.account?.acceptanceFixtureIdentity,
                            formEpoch: mount,
                            stage: { acceptanceStage(mount: mount) },
                            apply: { action, value, expected in
                                applyAcceptanceInput(
                                    action, value: value, expected: expected, mount: mount)
                            })
                    } catch {
                        store.reportNativeFailure(FacetAcceptanceError.invalidDescriptor)
                    }
                #endif
            }
            .onDisappear {
                #if DEBUG && os(iOS) && targetEnvironment(simulator)
                    acceptanceMount = nil
                    acceptanceInput?.stop()
                    acceptanceInput = nil
                #endif
                cancel()
                password = ""
                vaultPassword = ""
                code = ""
                if ownsPresentation(), store.accountPresentation.stage != .vaults {
                    store.resetAccountChallenge()
                }
                didDisappear?()
            }
        }.frame(minWidth: 320, minHeight: 360)
    }

    private func begin(_ operation: @escaping @MainActor (UUID) async -> Void) {
        guard ownsPresentation(), !busy else { return }
        let admittedRequest = UUID()
        requestID = admittedRequest
        submitting = true
        request = _Concurrency.Task {
            if !_Concurrency.Task.isCancelled { await operation(admittedRequest) }
            submitting = false
            request = nil
            requestID = nil
        }
    }
    private func cancel() {
        guard let requestID else { return }
        request?.cancel()
        store.cancelAccountRequest(id: requestID)
    }

    private func existingProfiles(_ vaultID: String) -> [FacetProfile] {
        let ids = Set(store.vaultConnections.filter { $0.vaultID == vaultID }.map(\.profileID))
        return store.profiles.filter { ids.contains($0.id) }
    }
}

#if DEBUG && os(iOS) && targetEnvironment(simulator)
    extension FacetAccountForm {
        private func acceptanceStage(mount: UUID) -> String? {
            guard acceptanceMount == mount, ownsPresentation(),
                UIApplication.shared.applicationState == .active
            else { return nil }
            switch store.accountPresentation.stage {
            case .credentials: return "credentials"
            case .verification: return "verification"
            case .vaults: return "vaults"
            }
        }

        private func applyAcceptanceInput(
            _ action: FacetAcceptanceInputAction, value: String?, expected: String, mount: UUID
        ) -> Bool {
            guard !busy, acceptanceStage(mount: mount) == expected else { return false }
            // Only the admitted, bound peer can reach this current-mount mutation boundary.
            acceptanceValuesConfined = true
            switch action {
            case .clear, .finish:
                guard action == .finish || expected == "credentials" else { return false }
                email = ""
                password = ""
                code = ""
                vaultPassword = ""
            case .email, .password, .verification:
                return fillAcceptanceCredentials(action, value: value, expected: expected)
            case .clearVault:
                guard expected == "vaults" else { return false }
                vaultPassword = ""
            case .vaultPassword:
                guard let value, expected == "vaults" else { return false }
                vaultPassword = value
            }
            return true
        }

        private func fillAcceptanceCredentials(
            _ action: FacetAcceptanceInputAction, value: String?, expected: String
        ) -> Bool {
            switch action {
            case .email:
                guard let value, expected == "credentials" else { return false }
                email = value
            case .password:
                guard let value, expected == "credentials" else { return false }
                password = value
            case .verification:
                guard let value, expected == "verification", store.accountNeedsCode else {
                    return false
                }
                code = value
            case .clear, .finish, .clearVault, .vaultPassword: return false
            }
            return true
        }
    }
#endif
