import SwiftUI
import TaskNotesKit

struct FacetAccountForm: View {
    @Bindable var store: FacetStore
    @State private var email = ""
    @State private var password = ""
    @State private var code = ""
    @State private var vaultPassword = ""
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                if store.remoteVaults.isEmpty {
                    Section("Obsidian account") {
                        TextField("Email", text: $email).textContentType(.emailAddress)
                            .accessibilityIdentifier("facet.account.email")
                        SecureField("Password", text: $password).textContentType(.password)
                            .accessibilityIdentifier("facet.account.password")
                        if store.accountNeedsCode {
                            TextField("Verification code", text: $code).textContentType(
                                .oneTimeCode
                            )
                            .accessibilityIdentifier("facet.account.code")
                        }
                        Button("Sign in") {
                            _Concurrency.Task {
                                await store.signIn(email: email, password: password, code: code)
                            }
                        }.disabled(store.isLoading || email.isEmpty || password.isEmpty)
                            .accessibilityIdentifier("facet.account.signin")
                    }
                } else {
                    Section("Your Sync vaults") {
                        SecureField("Vault encryption password", text: $vaultPassword)
                            .accessibilityIdentifier("facet.account.vault-password")
                        ForEach(store.remoteVaults) { vault in
                            ForEach(existingProfiles(vault.id)) { profile in
                                Button("Reconnect \(profile.name)") {
                                    _Concurrency.Task {
                                        await store.connectRemote(
                                            vault, password: vault.managed ? nil : vaultPassword,
                                            existingProfileID: profile.id)
                                    }
                                }.disabled(
                                    store.isLoading || (!vault.managed && vaultPassword.isEmpty))
                            }
                            Button(vault.name) {
                                _Concurrency.Task {
                                    await store.connectRemote(
                                        vault, password: vault.managed ? nil : vaultPassword)
                                }
                            }.disabled(store.isLoading || (!vault.managed && vaultPassword.isEmpty))
                                .accessibilityIdentifier("facet.account.vault.\(vault.id)")
                        }
                        Text(
                            "Facet downloads an independent copy of this vault, including its attachments. "
                                + "Obsidian settings are read as data."
                        )
                        .font(.caption).foregroundStyle(.secondary)
                    }
                }
                if store.isLoading { ProgressView() }
            }
            .navigationTitle("Obsidian Sync")
            .toolbar { Button("Done") { dismiss() }.disabled(store.isLoading) }
        }.frame(minWidth: 320, minHeight: 360)
    }

    private func existingProfiles(_ vaultID: String) -> [FacetProfile] {
        let ids = Set(store.vaultConnections.filter { $0.vaultID == vaultID }.map(\.profileID))
        return store.profiles.filter { ids.contains($0.id) }
    }
}
