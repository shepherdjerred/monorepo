public import SwiftUI
internal import TaskNotesKit

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
    public init() {}

    public var body: some View {
        TabView {
            GeneralSettingsView()
                .tabItem { Label("General", systemImage: "gearshape") }
        }
        .accessibilityIdentifier(AccessibilityIdentifier.settings)
        .frame(width: 460, height: 220)
    }
}

private struct GeneralSettingsView: View {
    var body: some View {
        Form {
            LabeledContent("Core version", value: CoreBuild.version)
            // Reading a value out of Rust here is not decoration. A build can
            // link against the bindings' header and still be missing the static
            // archive; showing the version means a broken link is visible the
            // first time anyone opens Settings.
        }
        .formStyle(.grouped)
    }
}
