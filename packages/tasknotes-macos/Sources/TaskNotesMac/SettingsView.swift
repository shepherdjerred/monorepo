public import SwiftUI
public import TaskNotesKit
public import TaskNotesUniFFI

/// The `Settings` scene's content, reached at `⌘,`.
///
/// A `TabView` is the macOS settings idiom. Two panes now: the server the app
/// talks to, and what it is running over. More arrive with the features that
/// need them.
///
/// Note what is *not* here and will not be: an in-app appearance toggle. The
/// app follows the system appearance, which is the platform contract.
public struct SettingsView: View {
    private let environment: AppEnvironment

    public init(environment: AppEnvironment) {
        self.environment = environment
    }

    public var body: some View {
        TabView {
            ServerSettingsView(environment: environment)
                .tabItem { Label("Server", systemImage: "network") }
            // The global hotkey has to be rebindable somewhere findable: it is
            // claimed from the window server rather than from a menu, so it is
            // the one binding in this app that can genuinely collide with
            // something the user already has.
            QuickAddSettingsView()
                .tabItem { Label("Quick Add", systemImage: "plus.viewfinder") }
            // Where a permanently-refused mutation goes to be seen. Settings
            // rather than a window of its own: it is rare, it is not part of
            // any daily loop, and the connection banner links straight here.
            ParkedChangesView(store: environment.store)
                .tabItem { Label("Parked", systemImage: "tray.full") }
            GeneralSettingsView(store: environment.store)
                .tabItem { Label("General", systemImage: "gearshape") }
        }
        // ⚠️ `.contain`. Three tabs of fields and buttons hang off this;
        // `.combine` would make the whole Settings window one element.
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Settings")
        .accessibilityIdentifier(AccessibilityIdentifier.settings)
        .frame(width: 480, height: 240)
    }
}

private struct ServerSettingsView: View {
    @Bindable var environment: AppEnvironment

    var body: some View {
        Form {
            TextField("Address", text: $environment.serverAddress, prompt: Text("http://…"))
                .textContentType(.URL)
                .accessibilityIdentifier(AccessibilityIdentifier.settingsServerURL)
                // Applied on commit rather than per keystroke: reconfiguring
                // builds a whole new engine, and doing that once per character
                // typed would dispose an engine mid-request seven times while
                // someone types a hostname.
                .onSubmit { environment.applyServerAddress() }
            // A `SecureField`, because this is a credential and the pane is as
            // likely to be open on a shared screen as anywhere else. It writes
            // through to the Keychain on every keystroke — cheap, and it means
            // there is no unsaved state to lose if the window is closed — but
            // the engine is only rebuilt on commit, for the same reason the
            // address is.
            SecureField("Token", text: $environment.authToken, prompt: Text("optional"))
                .accessibilityIdentifier(AccessibilityIdentifier.settingsServerToken)
                .onSubmit { environment.applyServerAddress() }
            LabeledContent("Status", value: statusDescription)
            Button("Connect") { environment.applyServerAddress() }
        }
        .formStyle(.grouped)
    }

    /// The engine's own state, spelled for a human.
    ///
    /// ⚠️ **One line, delegating, and it must stay that way.** This used to be a
    /// second `switch` over `SyncState`, living here in the view while
    /// ``SyncMessage`` did the same job for the banner. Two spellings of one
    /// fact diverge, and this one did: it reported `.idle` as "Connected", and
    /// `.idle` is also what an engine that has never made a request reports. A
    /// fresh install with no address, one with no token, and one that had just
    /// failed to reach anything all said "Connected".
    ///
    /// The fix is not a better `switch` here — it is not having a `switch` here.
    /// ``ConnectionSummary`` owns the mapping, tests the full cross product of
    /// state × `lastSyncTime` × store availability, and asserts structurally
    /// that no two situations collapse onto one word.
    private var statusDescription: String {
        ConnectionSummary.of(store: environment.store).title
    }
}

/// Settings ▸ Parked: the mutations the server refused for good.
///
/// ## Why a screen at all
///
/// The engine parks a command whose failure is permanent so the queue is not
/// wedged behind it, and rolls the optimistic edit back out of the list. Both
/// halves are right, and together they used to mean the user's change simply
/// disappeared: the dead-letter list was durable, and `retryDeadLetter` /
/// `discardDeadLetter` existed, but nothing on screen read either. Losing work
/// silently is worse than losing it loudly, so this pane is the loud part —
/// what was refused, why, and the two things anyone can do about it.
private struct ParkedChangesView: View {
    let store: Result<TaskNotesStore, CoreError>

    var body: some View {
        Form {
            switch store {
            case .failure(let error):
                Text(error.userMessage)
                    .foregroundStyle(.secondary)
            case .success(let store):
                let parked = ParkedChange.all(store.deadLetters)
                if parked.isEmpty {
                    // The empty state is the normal one, and saying so is the
                    // point: an empty list with no sentence reads like a screen
                    // that failed to load.
                    Text("Nothing is parked. Changes the server refuses for good show up here.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(parked) { change in
                        ParkedChangeRow(
                            change: change,
                            onRetry: {
                                // Detached, so the row responds to the click
                                // rather than to the drain it starts.
                                _Concurrency.Task { await store.retryDeadLetter(id: change.id) }
                            },
                            onDiscard: { store.discardDeadLetter(id: change.id) }
                        )
                    }
                }
            }
        }
        .formStyle(.grouped)
        .accessibilityIdentifier(AccessibilityIdentifier.settingsParked)
    }
}

/// One parked change, and the two things anyone can do about it.
///
/// Its own view so the snapshot suite can render the row without an engine that
/// has actually failed a command — the wording is the part a reviewer has to
/// look at, and staging a real permanent failure to see it would make the
/// picture cost a live server.
struct ParkedChangeRow: View {
    let change: ParkedChange
    let onRetry: () -> Void
    let onDiscard: () -> Void

    var body: some View {
        LabeledContent {
            HStack(spacing: 8) {
                Button("Retry", action: onRetry)
                // Destructive, and the only way to lose the change on purpose.
                Button("Discard", role: .destructive, action: onDiscard)
            }
        } label: {
            VStack(alignment: .leading, spacing: 1) {
                Text(change.summary)
                Text(change.reason)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

private struct GeneralSettingsView: View {
    let store: Result<TaskNotesStore, CoreError>

    var body: some View {
        Form {
            LabeledContent("Core version", value: CoreBuild.version)
            // Reading a value out of Rust here is not decoration. A build can
            // link against the bindings' header and still be missing the static
            // archive; showing the version means a broken link is visible the
            // first time anyone opens Settings.
            LabeledContent("Storage", value: storageDescription)
        }
        .formStyle(.grouped)
    }

    private var storageDescription: String {
        switch store {
        case .success(let store): return store.storageDescription
        case .failure(let error): return error.userMessage
        }
    }
}
