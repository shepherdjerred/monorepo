public import SwiftUI
internal import TaskNotesKit

/// The main window: a three-pane-capable `NavigationSplitView` currently used
/// with two columns.
///
/// This is the RN app's bottom tab bar translated to the platform idiom, not
/// ported. The sidebar is a real source list, so it gets Cmd-clickable rows,
/// system selection colours that de-emphasize on focus loss, and
/// `⌘⌃S` sidebar toggling for free — none of which a re-implemented tab bar
/// would have.
public struct RootView: View {
    @Bindable private var navigation: NavigationState
    private let environment: AppEnvironment

    /// Whether the trailing inspector is showing.
    ///
    /// `@SceneStorage` rather than `@State`, and that is a definition-of-done
    /// item rather than a nicety: window state restoration means a window
    /// reopens the way it was left, and the inspector's visibility is part of
    /// how it was left. It is also per-window by construction, so two windows
    /// can disagree — which is the whole reason the panel is a window property
    /// and the store is not.
    ///
    /// Open by default. An inspector nobody can find is a feature nobody has,
    /// and its empty state is a sentence explaining what to click.
    @SceneStorage("red.sjer.tasknotes.inspector.presented") private var isInspectorPresented = true

    public init(environment: AppEnvironment) {
        self.environment = environment
        self.navigation = environment.navigation
    }

    public var body: some View {
        NavigationSplitView {
            // `selection:` is non-optional, matching `NavigationState`: there
            // is no "nothing selected" state in this app.
            List(SidebarSection.allCases, id: \.self, selection: $navigation.selection) { section in
                Label(section.title, systemImage: section.systemImage)
                    // A `Label` is a container; putting the identifier on it
                    // without combining pushes the identifier down onto the
                    // child text element and leaves the row unidentified. This
                    // bites hardest on list rows, which is exactly what these
                    // are.
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier(AccessibilityIdentifier.sidebarItem(section))
            }
            .accessibilityIdentifier(AccessibilityIdentifier.sidebar)
            .navigationSplitViewColumnWidth(min: 180, ideal: 220, max: 320)
        } detail: {
            SectionDetailView(section: navigation.selection, store: environment.store)
                // The inspector belongs to the **window**, not to a section, so
                // it is attached here rather than inside `SectionDetailView`.
                // Switching Today → Upcoming therefore keeps it open, which is
                // what an attribute panel is supposed to do — and what a third
                // `NavigationSplitView` column could not, since a trailing
                // column cannot be collapsed at all.
                .inspector(isPresented: $isInspectorPresented) {
                    inspector
                }
                .toolbar {
                    ToolbarItem(placement: .primaryAction) {
                        Button("Inspector", systemImage: "sidebar.right") {
                            isInspectorPresented.toggle()
                        }
                        .help("Show or hide the inspector (⌥⌘I)")
                        .accessibilityIdentifier(AccessibilityIdentifier.Inspector.toggle)
                    }
                }
                .focusedSceneValue(\.inspectorPresentation, presentation)
        }
        // No `.navigationTitle` on the split view itself: the detail pane owns
        // the title so the window title tracks the visible content, which is
        // what the proxy icon and window menu expect.
        .task {
            environment.start()
        }
    }

    /// The panel's content.
    ///
    /// A store that could not be built has no tasks to inspect, and saying so
    /// here rather than rendering an empty form is the same choice
    /// `SectionDetailView` makes for the same reason: nothing below a storage
    /// failure is trustworthy.
    @ViewBuilder
    private var inspector: some View {
        switch environment.store {
        case .success(let store):
            TaskInspector(store: store)
        case .failure:
            ContentUnavailableView {
                Label("Unavailable", systemImage: "externaldrive.badge.exclamationmark")
            } description: {
                Text("TaskNotes cannot reach its stored data.")
            }
            .accessibilityIdentifier(AccessibilityIdentifier.Inspector.empty)
        }
    }

    /// The panel, as something the menu bar and a row's context menu can act on.
    private var presentation: InspectorPresentation {
        InspectorPresentation(
            isPresented: isInspectorPresented,
            toggle: { isInspectorPresented.toggle() },
            // Reveal only opens. Choosing "Edit…" on a task must never be the
            // gesture that closes the editor.
            reveal: { isInspectorPresented = true }
        )
    }
}
