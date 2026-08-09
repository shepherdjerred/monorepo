public import SwiftUI
internal import TaskNotesKit

/// The menu bar.
///
/// Four rules this follows, from the plan's definition of done:
///
///  * **Standard order, standard homes.** Nothing is invented. Destination
///    switching goes in View next to the sidebar toggle, the way Finder and
///    Mail place `⌘1`…`⌘4`; refresh goes in View; task creation goes where
///    `New` already lives in File; Delete goes in Edit, where every Mac app
///    puts it. Only the genuinely app-specific verbs get a menu of their own.
///  * **Disabled, never hidden.** Every item below is always present. When no
///    task list is frontmost, `@FocusedValue` is `nil` and the items grey out —
///    a menu that changes shape teaches the user nothing about where a command
///    lives, while a greyed-out one teaches them both that it exists and that
///    it does not apply right now. The Settings window is the case that proves
///    it: Complete is visible and dim there, not missing.
///  * **The focused value is the window, not the app.** Commands act on the
///    frontmost list rather than on a shared singleton, so two windows behave
///    like two windows.
///  * **`⌘,` is not declared here.** The `Settings` scene contributes it
///    automatically in the correct position in the app menu. Adding it by hand
///    is how apps end up with two.
public struct TaskNotesCommands: Commands {
    @Bindable private var navigation: NavigationState

    /// The frontmost task list, or `nil` when there is not one.
    @FocusedValue(\.taskListActions) private var actions: TaskListActions?

    /// The frontmost window's inspector, or `nil` when it has none — a Settings
    /// window, for instance, which is exactly when the item should be dim
    /// rather than missing.
    @FocusedValue(\.inspectorPresentation) private var inspector: InspectorPresentation?

    public init(navigation: NavigationState) {
        self.navigation = navigation
    }

    public var body: some Commands {
        // Replace rather than augment: the default `New` item creates a window
        // in a document app, which this is not.
        CommandGroup(replacing: .newItem) {
            Button("New Task") { actions?.newTask() }
                .keyboardShortcut("n")
                .disabled(actions == nil)
        }

        CommandGroup(after: .pasteboard) {
            Divider()
            Button("Delete") { actions?.delete() }
                .keyboardShortcut(.delete, modifiers: .command)
                .disabled(actions?.hasSelection != true)
        }

        // Find belongs below the pasteboard group in Edit, which is where every
        // Mac app puts it. `.textEditing` is the group that already holds Select
        // All, so `after:` lands Find under it.
        CommandGroup(after: .textEditing) {
            Divider()
            Button("Find…") { actions?.find() }
                .keyboardShortcut("f")
                .disabled(actions == nil)
            Button("Clear Filters") { actions?.clearFilters() }
                .disabled(actions?.isNarrowed != true)
        }

        // View > Toggle Sidebar, and View > Show/Customize Toolbar.
        SidebarCommands()
        ToolbarCommands()

        // `⌥⌘I` is the platform's inspector shortcut — Xcode, Pages, Numbers,
        // Keynote and Freeform all use it, so it already means this. SwiftUI's
        // `.inspector` contributes no menu item of its own, unlike
        // `SidebarCommands`, so the panel would otherwise be reachable only by
        // a toolbar button and therefore invisible to the keyboard.
        //
        // The label states what the item will *do*, which is the macOS
        // convention — Show Inspector when hidden, Hide Inspector when shown —
        // rather than a checkmark on a static title.
        CommandGroup(after: .sidebar) {
            Button(inspector?.isPresented == true ? "Hide Inspector" : "Show Inspector") {
                inspector?.toggle()
            }
            .keyboardShortcut("i", modifiers: [.option, .command])
            .disabled(inspector == nil)
        }

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

            // The desktop replacement for the touch app's pull-to-refresh.
            Button("Refresh") { actions?.refresh() }
                .keyboardShortcut("r")
                .disabled(actions == nil || actions?.isRefreshing == true)
        }

        // The one menu this app adds, and it is added rather than squeezed into
        // an existing one because "complete a task" has no standard home. A
        // custom menu belongs between View and Window, which is where SwiftUI
        // places `CommandMenu`.
        CommandMenu("Task") {
            Button("Complete") { actions?.complete() }
                // `⌘.` is Things's binding for the same verb. It is normally
                // Cancel, but Cancel is a *modal* convention — it is Escape's
                // alias inside sheets and alerts, and this app has none in the
                // main window. Inside a text field the field editor still
                // routes it to `cancelOperation(_:)`, which `PlainTextField`
                // handles, so composing is never interrupted by it.
                .keyboardShortcut(".", modifiers: .command)
                .disabled(actions?.hasSelection != true)
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
