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
    /// The frontmost window's selection, or `nil` when the window in front has
    /// none — the Settings window, for instance.
    ///
    /// A focused value rather than an injected object, for the reason stated
    /// three bullets up: the menu bar is one thing and there are many windows.
    /// Injecting it meant every window shared one selection, so Go To moved
    /// every open window at once.
    @FocusedValue(\.navigationState) private var navigation: NavigationState?

    /// The frontmost task list, or `nil` when there is not one.
    @FocusedValue(\.taskListActions) private var actions: TaskListActions?

    /// The frontmost window's inspector, or `nil` when it has none — a Settings
    /// window, for instance, which is exactly when the item should be dim
    /// rather than missing.
    @FocusedValue(\.inspectorPresentation) private var inspector: InspectorPresentation?

    /// The frontmost board, or `nil` when the window in front is not one.
    @FocusedValue(\.boardActions) private var board: BoardActions?

    public init() {}

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
            // "& Search" because the filter badge counts a non-empty query as a
            // dimension, so a `(1)` the user got by typing in the search box has
            // to be undoable by something that says it clears search. The list's
            // own filter menu and empty state use the same wording.
            Button("Clear Filters & Search") { actions?.clearFilters() }
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
            // Bound to `selectedSection`, which is `nil` while a project, a
            // saved view or the board is open — so the picker shows no
            // checkmark there. That is the honest reading: those destinations
            // have no `⌘n`, and a checkmark next to Browse because a project
            // screen happens to be *built* out of Browse would be a lie the
            // reader has no way to check.
            Picker("Go To", selection: selectedSection) {
                ForEach(Array(SidebarSection.allCases.enumerated()), id: \.element) {
                    index, section in
                    Text(section.title)
                        .keyboardShortcut(shortcut(forIndex: index))
                        // ⚠️ `Optional(section)`, not `section`. The selection
                        // is now optional, and a non-optional tag against an
                        // optional selection is the well-known SwiftUI failure
                        // where every item is silently unselectable — the same
                        // trap `SortChoice` exists to avoid on the sort menu.
                        .tag(Optional(section))
                }
            }
            .pickerStyle(.inline)
            .disabled(navigation == nil)

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

            Divider()

            // ⚠️ **The keyboard half of the board's drag-and-drop.** Dragging a
            // card between columns is a pointer-only gesture — VoiceOver cannot
            // perform one and XCUITest cannot synthesize one — so the move has
            // to be reachable from here as well as from a card's context menu.
            // All three routes dispatch the same `setStatus`.
            //
            // `⌃⌘` with an arrow because `⌘←/→` is line-start/line-end inside
            // any text field on screen and `⌥⌘←/→` is tab switching nearly
            // everywhere; `⌃⌘` plus an arrow is unclaimed and already reads as
            // "move the thing" from Mission Control.
            //
            // Disabled, never hidden: on a list screen there is no board to
            // move a card on, so these grey out rather than disappearing.
            ForEach([KanbanDirection.previous, .next], id: \.self) { direction in
                Button(direction.title) { board?.move(direction) }
                    .keyboardShortcut(
                        direction == .previous ? .leftArrow : .rightArrow,
                        modifiers: [.control, .command]
                    )
                    .disabled(board?.canMove(direction) != true)
            }
        }

        CommandGroup(replacing: .help) {
            Button("Facet Help") {}
                .disabled(true)
        }
    }

    /// The frontmost window's section, as something the `Picker` can write to.
    ///
    /// Built here rather than taken from `@Bindable`, because the value being
    /// bound is optional at a second level: there may be no window in front at
    /// all. Reading through the optional keeps the picker showing no checkmark
    /// in that case, which is the same honest answer it already gives while a
    /// project or a saved view is open.
    private var selectedSection: Binding<SidebarSection?> {
        Binding(
            get: { navigation?.selectedSection },
            set: { navigation?.selectedSection = $0 }
        )
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
