internal import SwiftUI
internal import TaskNotesKit
internal import TaskNotesUniFFI

/// The detail pane.
///
/// Today is real as of Phase 8. Inbox, Upcoming and Browse are
/// parameterizations of the same screen rather than three near-identical
/// triplets, and they land in Phase 9 — until then they are honest placeholders
/// rather than half-built lists.
struct SectionDetailView: View {
    let section: SidebarSection
    let store: Result<TaskNotesStore, CoreError>

    var body: some View {
        switch store {
        case .failure(let error):
            unavailable(
                title: "TaskNotes cannot store its data",
                description: error.userMessage,
                symbol: "externaldrive.badge.exclamationmark"
            )
        case .success(let store):
            switch section {
            case .today:
                TodayView(store: store)
            case .inbox, .upcoming, .browse:
                unavailable(
                    title: section.title,
                    description: "This list arrives with the remaining screens.",
                    symbol: section.systemImage
                )
            }
        }
    }

    /// `ContentUnavailableView` rather than a hand-rolled placeholder: it is
    /// the platform's empty state, so it already tracks system appearance,
    /// dynamic type, and the de-emphasized styling an inactive window should
    /// have.
    private func unavailable(
        title: String,
        description: String,
        symbol: String
    ) -> some View {
        ContentUnavailableView {
            Label(title, systemImage: symbol)
        } description: {
            Text(description)
        }
        .accessibilityIdentifier(AccessibilityIdentifier.detail(section))
        .navigationTitle(section.title)
        .navigationSubtitle("TaskNotes")
    }
}
