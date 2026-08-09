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
            GeneralSettingsView(store: environment.store)
                .tabItem { Label("General", systemImage: "gearshape") }
        }
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
            LabeledContent("Status", value: statusDescription)
            Button("Connect") { environment.applyServerAddress() }
        }
        .formStyle(.grouped)
    }

    /// The engine's own state, spelled for a human.
    ///
    /// Exhaustive over `SyncState`: `default:` is banned here precisely so a
    /// new state in the Rust enum becomes a compile error rather than silently
    /// rendering as one of the old ones.
    private var statusDescription: String {
        guard case .success(let store) = environment.store else { return "Unavailable" }
        switch store.status.state {
        case .idle: return "Connected"
        case .syncing: return "Syncing"
        case .backoff: return "Waiting to retry"
        case .authError: return "Authentication failed"
        case .unconfigured: return "No server configured"
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
