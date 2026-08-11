internal import SwiftUI
internal import TaskNotesKit
internal import TaskNotesUniFFI

/// The time-report window.
///
/// A leaderboard, which is what the React Native screen is too — a total across
/// the top, then one row per task. Two things are different, and both are
/// desktop rather than decoration:
///
///   * **A bar per row.** The phone prints a number on the right and leaves the
///     reader to compare seven of them. The share is already in the model, and a
///     bar turns "which of these took the day" from arithmetic into a glance.
///   * **A `List`, not a `FlatList`.** Momentum, rubber-banding, Page Up/Down,
///     Home/End and the de-emphasised selection on focus loss all come from
///     `NSTableView` underneath, and every one of them is lost silently by a
///     hand-rolled `ScrollView`.
///
/// See ``TimeReport`` for why the scope is all-time and what the core would have
/// to export for it not to be.
struct TimeReportView: View {
    let store: Result<TaskNotesStore, CoreError>

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier(AccessibilityIdentifier.Timing.report)
    }

    @ViewBuilder
    private var content: some View {
        switch store {
        case .success(let store):
            TimeReportContent(report: TimeReport.ofTrackedTotals(tasks: store.tasks))
        case .failure(let error):
            // Nothing below a storage failure is trustworthy, so the window says
            // so rather than rendering a plausible-looking report of nothing —
            // the same choice `SectionDetailView` makes for the same reason.
            ContentUnavailableView {
                Label("Unavailable", systemImage: "externaldrive.badge.exclamationmark")
            } description: {
                Text(error.userMessage)
            }
            .accessibilityIdentifier(AccessibilityIdentifier.Timing.reportEmpty)
        }
    }
}

/// The report itself, over a derived value rather than over a store.
///
/// Split from ``TimeReportView`` so a rendered image can be produced from a
/// `TimeReport` directly. The alternative — seeding a whole store with tracked
/// tasks to look at a bar chart — would have made the picture depend on the
/// storage layer, and the two have nothing to do with each other.
struct TimeReportContent: View {
    let report: TimeReport

    var body: some View {
        if report.isEmpty {
            ContentUnavailableView {
                Label("No tracked time", systemImage: "hourglass")
            } description: {
                Text("Start tracking time on a task and it will appear here.")
            }
            .accessibilityIdentifier(AccessibilityIdentifier.Timing.reportEmpty)
        } else {
            VStack(spacing: 0) {
                total
                Divider()
                List(report.rows) { row in
                    TimeReportRowView(row: row)
                }
                .listStyle(.inset)
            }
        }
    }

    /// The grand total, and the one thing the reader has to know about it.
    ///
    /// "All time" is stated rather than assumed. The phone's report takes a
    /// period, so a Mac window that showed a bare number would be read as
    /// *today* by anybody who has used the phone — and would be wrong by
    /// however long they have owned the vault.
    private var total: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 1) {
                Text("Total")
                    .font(.title2.weight(.semibold))
                Text("All time")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text(TimeReport.text(minutes: report.totalMinutes))
                .font(.title2.weight(.semibold).monospacedDigit())
                .accessibilityIdentifier(AccessibilityIdentifier.Timing.reportTotal)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .accessibilityElement(children: .combine)
    }
}

/// One task's tracked time.
private struct TimeReportRowView: View {
    let row: TimeReportRow

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(row.title)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 8)
                Text(row.text())
                    .font(.callout.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .fixedSize()
            }
            // A share, not a progress bar, so it carries no accent colour and no
            // sense of completion: nobody is "70% done" with a day's work.
            // `.tertiary` over the row's own background keeps it a background
            // measure that the title still reads over.
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(.quinary)
                    Capsule()
                        .fill(.tertiary)
                        .frame(width: max(2, proxy.size.width * row.share))
                }
            }
            .frame(height: 4)
            .accessibilityHidden(true)
        }
        .padding(.vertical, 3)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(AccessibilityIdentifier.Timing.reportRow(row.taskId))
        .accessibilityLabel("\(row.title), \(row.text())")
    }
}
