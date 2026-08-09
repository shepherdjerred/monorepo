public import SwiftUI
internal import TaskNotesKit

/// The detail pane.
///
/// Deliberately empty in Phase 7. Each destination gets a real view later —
/// Today first, as the Phase 8 quality gate; Inbox, Upcoming and Browse are
/// parameterizations of it in Phase 9 rather than three near-identical
/// triplets.
///
/// `ContentUnavailableView` rather than a hand-rolled placeholder: it is the
/// platform's empty state, so it already tracks system appearance, dynamic
/// type, and the de-emphasized styling an inactive window should have.
struct SectionDetailView: View {
    let section: SidebarSection

    var body: some View {
        ContentUnavailableView {
            Label(section.title, systemImage: section.systemImage)
        } description: {
            Text("Nothing here yet.")
        }
        .accessibilityIdentifier(AccessibilityIdentifier.detail(section))
        .navigationTitle(section.title)
        .navigationSubtitle("TaskNotes")
    }
}
