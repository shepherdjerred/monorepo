public import SwiftUI
public import TaskNotesKit
public import TaskNotesUniFFI

/// The `Settings` scene's content, reached at `⌘,`.
///
/// A `TabView` with `.tabViewStyle(.grouped)`-free defaults is the macOS
/// settings idiom; a single tab is used here because Phase 7 has exactly one
/// thing worth showing. Additional panes (Vault, Sync, Appearance) land with
/// the features that need them.
///
/// Note what is *not* here and will not be: an in-app appearance toggle. The
/// app follows the system appearance, which is the platform contract.
public struct SettingsView: View {
    private let store: Result<TaskNotesStore, CoreError>

    public init(store: Result<TaskNotesStore, CoreError>) {
        self.store = store
    }

    public var body: some View {
        TabView {
            GeneralSettingsView(store: store)
                .tabItem { Label("General", systemImage: "gearshape") }
        }
        .accessibilityIdentifier(AccessibilityIdentifier.settings)
        .frame(width: 460, height: 220)
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
            LabeledContent("Sync", value: syncDescription)
            LabeledContent("Storage", value: storageDescription)
        }
        .formStyle(.grouped)
    }

    /// The engine's own state, spelled for a human.
    ///
    /// Exhaustive over `SyncState`: `default:` is banned here precisely so a
    /// new state in the Rust enum becomes a compile error rather than silently
    /// rendering as one of the old ones.
    private var syncDescription: String {
        guard case .success(let store) = store else { return "Unavailable" }
        switch store.status.state {
        case .idle: return "Idle"
        case .syncing: return "Syncing"
        case .backoff: return "Waiting to retry"
        case .authError: return "Authentication failed"
        case .unconfigured: return "No server configured"
        }
    }

    private var storageDescription: String {
        switch store {
        case .success(let store): return store.storageDescription
        case .failure(let error): return String(describing: error)
        }
    }
}
