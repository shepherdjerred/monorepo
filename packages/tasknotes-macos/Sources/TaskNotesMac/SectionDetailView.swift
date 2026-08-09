internal import SwiftUI
internal import TaskNotesKit
internal import TaskNotesUniFFI

/// The detail pane, for whichever destination is selected.
///
/// ## Almost everything here is the same screen
///
/// Today, Inbox, Upcoming and Browse were three near-identical triplets plus a
/// directory in the React Native app, and `ProjectDetailScreen`,
/// `ContextDetailScreen` and `TagDetailScreen` were three more copies of the
/// same file differing in one `filter` call. Here all seven are
/// ``TaskListView`` — four of them a ``SidebarSection`` and three of them a
/// ``TaskListScope`` — so this type routes rather than branching on layout.
///
/// The board is the one destination that is genuinely a different screen,
/// because columns are a different arrangement of the same rows rather than a
/// different set of them.
struct SectionDetailView: View {
    let destination: TaskNotesDestination
    let store: Result<TaskNotesStore, CoreError>

    /// The saved views, so a `.savedView` destination can be resolved to one.
    let savedViews: SavedViewStore

    var body: some View {
        switch store {
        case .failure(let error):
            ContentUnavailableView {
                Label(
                    "TaskNotes cannot store its data",
                    systemImage: "externaldrive.badge.exclamationmark")
            } description: {
                Text(error.userMessage)
            }
            .accessibilityIdentifier(AccessibilityIdentifier.detail(destination))
            .navigationTitle("TaskNotes")
        case .success(let store):
            screen(store)
                // ⚠️ Load-bearing, not tidiness. `@State` survives a change of a
                // view's stored properties, so without an identity tied to the
                // destination, switching from Today to Inbox would keep Today's
                // selection, search text and sort order — three pieces of state
                // that mean nothing on the screen they arrived at.
                //
                // It is the **destination's** identity and not the section's,
                // which matters now that every project screen is `.browse`:
                // keyed on the section, moving from one project to the next
                // would carry the previous project's search across, and the two
                // screens would look like one that had not updated.
                .id(destination.identity)
        }
    }

    @ViewBuilder
    private func screen(_ store: TaskNotesStore) -> some View {
        switch destination {
        case .section(let section):
            TaskListView(section: section, store: store)
        case .entity(let entity):
            // Browse is the section, because an entity screen shows *every*
            // task filed under it — finished ones included, which is what the
            // React Native screens do and the only reading under which "no
            // tasks in this project" means the project is finished rather than
            // merely filtered.
            TaskListView(section: .browse, store: store, scope: entity.scope)
        case .savedView(let id):
            savedViewScreen(store, id: id)
        case .board:
            KanbanBoardView(store: store)
        }
    }

    /// A saved view, or an honest account of a link to one that is gone.
    ///
    /// Deleted views are resolved **here** rather than in the router, because
    /// this is the only layer that can both see the store and say something.
    /// `NavigationState` deliberately holds an id it has not validated — see
    /// its `open(_:)` — so a stale `tasknotes://view/…` bookmark selects
    /// something, and what it selects explains itself.
    @ViewBuilder
    private func savedViewScreen(_ store: TaskNotesStore, id: SavedView.ID) -> some View {
        if let view = savedViews.view(id: id) {
            TaskListView(
                section: .browse,
                store: store,
                query: view.seededQuery,
                scope: view.scope
            )
        } else {
            ContentUnavailableView {
                Label("This view no longer exists", systemImage: "questionmark.folder")
            } description: {
                Text("The saved view “\(id)” has been deleted.")
            }
            .accessibilityIdentifier(AccessibilityIdentifier.detail(destination))
            .navigationTitle("Saved View")
        }
    }
}
