import SwiftUI
import TaskNotesKit

internal struct FacetOccurrenceTaskIdentity: Hashable {
    let profileID: String
    let path: String
    let revision: String
}

/// The same core-authored series actions appear in the desktop inspector and
/// mobile task sheet. Unsaved editor text always retains ownership of the task.
internal struct FacetOccurrenceGenerationSection: View {
    let store: FacetStore
    let task: FacetTask
    let profileID: String
    let disabled: Bool
    var applied: @MainActor () -> Void = {}
    @State private var submitting = false
    @Environment(\.facetFeedbackOrigin) private var feedbackOrigin

    private var target: FacetOccurrenceTarget? {
        store.occurrenceOverviews[profileID]?.targets.first {
            $0.parentPath == task.path && $0.expectedParentRevision == task.revision
        }
    }
    private var failures: [FacetGenerationFailure] {
        store.occurrenceOverviews[profileID]?.failures.filter {
            $0.applies(toTaskPath: task.path)
        } ?? []
    }
    private var problem: FacetOccurrenceProblem? {
        store.occurrenceOverviews[profileID]?.problems.first { $0.taskPath == task.path }
    }

    var body: some View {
        Group {
            if target != nil || !failures.isEmpty || problem != nil
                || (task.isRecurring && store.occurrenceIssues[profileID] != nil)
            {
                Section("Series") {
                    if let target {
                        Text("Generate future tasks from \(target.start) through \(target.end).")
                            .font(.caption).foregroundStyle(.secondary)
                        Button("Generate window", systemImage: "calendar.badge.plus") {
                            submit(target.command())
                        }.accessibilityIdentifier("facet.series.generate")
                    }
                    ForEach(failures) { failure in
                        VStack(alignment: .leading, spacing: 6) {
                            Label(
                                "Future occurrence needs attention",
                                systemImage: "exclamationmark.triangle")
                            if let message = failure.item.failure?.message {
                                Text(message).font(.caption).foregroundStyle(.secondary)
                            }
                            if failure.action.kind == "repairable",
                                let command = failure.action.command
                            {
                                Button(
                                    "Repair generation", systemImage: "arrow.triangle.2.circlepath"
                                ) {
                                    submit(command)
                                }.accessibilityIdentifier("facet.series.repair")
                            } else {
                                Text(
                                    "Review the series and occurrence notes before generating again."
                                )
                                .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                    if problem != nil {
                        Label(
                            "Review this series’ recurrence settings before generating tasks.",
                            systemImage: "exclamationmark.triangle"
                        ).font(.caption)
                    }
                    if let issue = store.occurrenceIssues[profileID] {
                        Text(issue).font(.caption).foregroundStyle(.secondary)
                    }
                    if submitting { ProgressView().controlSize(.small) }
                }.disabled(disabled || submitting || store.isSaving)
            }
        }
    }

    private func submit(_ command: FacetValue) {
        guard !disabled, !submitting, let fields = command.object?.fields else { return }
        submitting = true
        let intent = store.feedbackIntent(origin: feedbackOrigin)
        _Concurrency.Task {
            let saved = await FacetFeedbackContext.$intent.withValue(intent) {
                await store.perform(fields, profileID: profileID)
            }
            submitting = false
            if saved { applied() }
        }
    }
}
