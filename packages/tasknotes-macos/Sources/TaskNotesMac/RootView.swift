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
    /// This window's selection.
    ///
    /// `@State`, so SwiftUI builds one per `WindowGroup` instance — which is
    /// the entire per-window navigation model. It used to come from
    /// `AppEnvironment`, which every window shares, so a second window moved
    /// the first one's sidebar. See ``NavigationState``.
    @State private var navigation = NavigationState()

    private let environment: AppEnvironment

    /// Opens the pomodoro and time-report windows, by the ids ``TimingWindow``
    /// names.
    @Environment(\.openWindow) private var openWindow

    /// Opens the Settings scene — the same window `⌘,` opens, not a second
    /// copy of it.
    @Environment(\.openSettings) private var openSettings

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

    /// Bumped every time this window is asked to put the caret in its search
    /// field, which is what `tasknotes://search` resolves to here.
    ///
    /// A counter rather than a `Bool`, for the reason
    /// `QuickAddPanelController.focusToken` is one: the request has to be
    /// re-armable. A flag set to `true` is already `true` the second time the
    /// link arrives, so nothing downstream changes and the caret does not move.
    ///
    /// It lives here rather than on ``NavigationState`` — which is the
    /// selection and nothing else — beside the inspector's visibility, the
    /// other piece of per-window presentation this view already owns. Per
    /// window is the point: reading the frontmost list's `find` out of
    /// `@FocusedValue` instead would have let a link delivered to one window
    /// focus a different window's search field.
    @State private var searchFocusToken = 0

    public init(environment: AppEnvironment) {
        self.environment = environment
    }

    public var body: some View {
        NavigationSplitView {
            // The source list is more than the four fixed screens now — it
            // carries the board, the saved views, and the vault's own projects,
            // contexts and tags — so it lives in its own view and its selection
            // is a `TaskNotesDestination`. `selection:` stays non-optional,
            // matching `NavigationState`: there is no "nothing selected" state
            // in this app.
            SidebarList(
                navigation: navigation,
                vocabulary: vocabulary,
                savedViews: environment.savedViews
            )
            .navigationSplitViewColumnWidth(min: 180, ideal: 220, max: 320)
        } detail: {
            SectionDetailView(
                destination: navigation.selection,
                store: environment.store,
                savedViews: environment.savedViews,
                searchFocusToken: searchFocusToken
            )
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
        // `tasknotes://…`. Handled here rather than on the scene's content in
        // `App/` because the selection it moves belongs to *this* window: the
        // scene-level handler could only ever reach one shared object, which is
        // the per-window model given away. The URL is parsed in `TaskNotesKit`,
        // so an unhandled link is rejected there rather than being routed to
        // some arbitrary default.
        .onOpenURL { url in
            guard let link = TaskNotesURL(url) else { return }
            switch link.target {
            case .destination(let destination): show(destination)
            case .action(let action): perform(action)
            }
        }
        // What the View menu's Go To picker binds to. The menu bar is one thing
        // and there are many windows, so the command reads the frontmost
        // window's state rather than holding a reference to a singleton.
        .focusedSceneValue(\.navigationState, navigation)
    }

    /// Point this window at a place a link named.
    private func show(_ destination: TaskNotesDestination) {
        navigation.open(destination)
        // A link to a task is a link to the panel that shows it, so a closed
        // inspector is opened — never toggled, and never closed by a link to
        // anything else. `⌥⌘I` is how the user closes it, and a deep link that
        // could do so would be a link that sometimes hid the thing it was asked
        // to show.
        if case .task = destination {
            isInspectorPresented = true
        }
    }

    /// Do the thing a link named, on the surface this app already has for it.
    ///
    /// Every case reaches an existing affordance rather than a link-only copy of
    /// one: the same panel File › Quick Add… opens, the same field `⌘F` focuses,
    /// the same Settings scene `⌘,` opens, and the two `Window` scenes the
    /// Window menu already lists. A second surface reachable only by URL is how
    /// two implementations of one feature start.
    private func perform(_ action: TaskNotesAction) {
        switch action {
        case .quickAdd:
            environment.quickAdd.present()
        case .search:
            // The frontmost list picks this up and takes focus. On a destination
            // with no list — a storage failure, a deleted saved view — there is
            // no search field to put a caret in, and inventing somewhere else
            // for the link to land would be worse than it doing nothing.
            searchFocusToken &+= 1
        case .settings:
            openSettings()
        case .pomodoro:
            openWindow(id: TimingWindow.pomodoro.rawValue)
        case .timeReport:
            openWindow(id: TimingWindow.timeReport.rawValue)
        }
    }

    /// The vault's projects, contexts and tags, for the sidebar's three groups.
    ///
    /// Derived from the store's own snapshot rather than kept as state, so a
    /// project that appears on a task the moment a sync lands appears in the
    /// sidebar in the same redraw. `TaskVocabulary.of` is a single pass over
    /// the tasks with the core's `project_matches` doing the deduplication.
    private var vocabulary: TaskVocabulary {
        guard case .success(let store) = environment.store else { return .empty }
        return TaskVocabulary.of(tasks: store.tasks)
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
                Text("Facet cannot reach its stored data.")
            }
            // `.combine`: a headline and a sentence, no control to swallow.
            .accessibilityElement(children: .combine)
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
