internal import SwiftUI
internal import TaskNotesKit
internal import TaskNotesUniFFI

/// The detail pane.
///
/// All four destinations are the same screen. Today, Inbox, Upcoming and Browse
/// were three near-identical triplets plus a directory in the React Native app;
/// here they are one ``TaskListView`` and four configurations, so this type has
/// nothing left to switch on.
struct SectionDetailView: View {
    let section: SidebarSection
    let store: Result<TaskNotesStore, CoreError>

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
            .accessibilityIdentifier(AccessibilityIdentifier.detail(section))
            .navigationTitle(section.title)
            .navigationSubtitle("TaskNotes")
        case .success(let store):
            TaskListView(section: section, store: store)
                // ⚠️ Load-bearing, not tidiness. `@State` survives a change of
                // a view's stored properties, so without an identity tied to
                // the section, switching from Today to Inbox would keep Today's
                // selection, search text and sort order — three pieces of state
                // that mean nothing on the screen they arrived at. The identity
                // is what makes "four screens, one view" behave like four
                // screens.
                .id(section)
        }
    }
}
