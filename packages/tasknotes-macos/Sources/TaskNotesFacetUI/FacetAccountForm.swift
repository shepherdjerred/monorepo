import SwiftUI
import TaskNotesKit

struct FacetAccountForm: View {
    @Bindable var store: FacetStore
    @State private var email = ""
    @State private var password = ""
    @State private var code = ""
    @State private var vaultPassword = ""
    @State private var submitting = false
    @State private var request: _Concurrency.Task<Void, Never>?
    @State private var requestID: UUID?
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
                                        busy || (!vault.managed && vaultPassword.isEmpty))
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
                    }
                }
            }
            .navigationTitle("Obsidian Sync")
            .toolbar {
                Button(busy ? "Cancel" : "Done") {
                    cancel()
                    dismiss()
                }
            }
            .onChange(of: email) {
                store.accountCredentialsChanged()
                code = ""
            }
            .onChange(of: password) {
                store.accountCredentialsChanged()
                code = ""
            }
            .onChange(of: scenePhase) {
                if scenePhase == .background { cancel() }
            }
            .onDisappear {
                cancel()
                password = ""
                vaultPassword = ""
                code = ""
                if store.accountPresentation.stage != .vaults { store.resetAccountChallenge() }
            }
        }.frame(minWidth: 320, minHeight: 360)
    }

    private func begin(_ operation: @escaping @MainActor (UUID) async -> Void) {
        guard !busy else { return }
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
