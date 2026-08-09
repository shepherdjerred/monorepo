public import SwiftUI
internal import TaskNotesKit

/// The menu bar.
///
/// Three rules this follows, from the plan's definition of done:
///
///  * **Standard order, standard homes.** Nothing is invented. Destination
///    switching goes in View next to the sidebar toggle, the way Finder and
///    Mail place `⌘1`…`⌘4`; refresh goes in View; task creation goes where
///    `New` already lives in File.
///  * **Disabled, never hidden.** Phase 7 has no store, so `New Task` and
///    `Refresh` cannot do anything yet — and they are shown greyed out rather
///    than omitted. A menu that changes shape teaches the user nothing about
///    where a command lives; a greyed-out one teaches them both that it exists
///    and that it does not apply right now.
///  * **`⌘,` is not declared here.** The `Settings` scene contributes it
///    automatically in the correct position in the app menu. Adding it by hand
///    is how apps end up with two.
public struct TaskNotesCommands: Commands {
    @Bindable private var navigation: NavigationState

    public init(navigation: NavigationState) {
        self.navigation = navigation
    }

    public var body: some Commands {
        // Replace rather than augment: the default `New` item creates a window
        // in a document app, which this is not.
        CommandGroup(replacing: .newItem) {
            Button("New Task") {}
                .keyboardShortcut("n")
                // Enabled in Phase 8, with the store that can create one.
                .disabled(true)
        }

        // View > Toggle Sidebar, and View > Show/Customize Toolbar.
        SidebarCommands()
        ToolbarCommands()

        CommandGroup(after: .sidebar) {
            Divider()
            // A `Picker` bound to the selection gives real menu-item state —
            // the current destination shows a checkmark — instead of four
            // buttons that all look identical regardless of where you are.
            Picker("Go To", selection: $navigation.selection) {
                ForEach(Array(SidebarSection.allCases.enumerated()), id: \.element) {
                    index, section in
                    Text(section.title)
                        .keyboardShortcut(shortcut(forIndex: index))
                        .tag(section)
                }
            }
            .pickerStyle(.inline)

            Divider()

            Button("Refresh") {}
                .keyboardShortcut("r")
                // The desktop replacement for the RN app's pull-to-refresh.
                // Enabled in Phase 8 alongside the sync engine.
                .disabled(true)
        }

        CommandGroup(replacing: .help) {
            Button("TaskNotes Help") {}
                .disabled(true)
        }
    }

    /// `⌘1` … `⌘4`, positionally.
    ///
    /// Derived from the index rather than hard-coded per case so a fifth
    /// destination cannot silently ship without a shortcut. Beyond nine
    /// destinations there is no digit left, and a menu that deep needs a
    /// different design rather than a tenth accelerator.
    private func shortcut(forIndex index: Int) -> KeyboardShortcut? {
        guard let digit = "123456789".dropFirst(index).first else { return nil }
        return KeyboardShortcut(KeyEquivalent(digit))
    }
}
