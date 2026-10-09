import SwiftUI
import TaskNotesKit

internal struct FacetNativeSettings: View {
    let store: FacetStore
    @Binding var importsFolder: Bool
    var body: some View {
        List {
            Section("Vaults") {
                ForEach(store.profiles) { profile in
                    Button {
                        _Concurrency.Task { await store.selectProfile(profile.id) }
                    } label: {
                        HStack {
                            Text(profile.name)
                            Spacer()
                            if store.selectedProfileID == profile.id {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                }
                Button("Import vault copy…") { importsFolder = true }
                Button("Connect Obsidian Sync…") { store.showsAccount = true }
            }
            Section("Reminders") {
                Toggle(
                    "Task reminders",
                    isOn: Binding(
                        get: { store.remindersEnabled },
                        set: { enabled in
                            _Concurrency.Task {
                                if enabled {
                                    await store.enableReminders()
                                } else {
                                    await store.disableReminders()
                                }
                            }
                        }))
            }
            #if os(iOS)
                Section("Feedback") {
                    Toggle(
                        "Haptics and sounds",
                        isOn: Binding(
                            get: { FacetNativeFeedback.shared.enabled },
                            set: { FacetNativeFeedback.shared.setEnabled($0) }))
                    if let error = FacetNativeFeedback.shared.error {
                        Label(error, systemImage: "exclamationmark.triangle")
                        Button("Reset feedback preference") {
                            FacetNativeFeedback.shared.setEnabled(true)
                        }
                    }
                }
            #endif
            Section("Sync and recovery") {
                Button("Refresh vault", systemImage: "arrow.clockwise") {
                    _Concurrency.Task { await store.refresh() }
                }
                Button(
                    "Resolve conflicts", systemImage: "exclamationmark.arrow.triangle.2.circlepath"
                ) { store.showsConflicts = true }
                ForEach(store.pendingActions) { action in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(action.id).font(.caption).textSelection(.enabled)
                        HStack {
                            Button("Resume") {
                                _Concurrency.Task { await store.resumeSavedAction(action) }
                            }
                            Button("Retire", role: .destructive) {
                                _Concurrency.Task { await store.retireSavedAction(action) }
                            }
                        }
                    }
                }
                Button("Sign out of Obsidian", role: .destructive) {
                    _Concurrency.Task { await store.signOut() }
                }
            }
        }.navigationTitle("Settings")
    }
}
