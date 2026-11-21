import SwiftUI
import TaskNotesKit

/// A short-lived display of the row the user just checked. Storage and Undo update immediately.
internal struct FacetCompletionRow {
    let previous: Task
    let destination: FacetDestination
    let receipt: String
    var holdsPosition = true
}

extension FacetStore {
    internal func acknowledgeCompletion(of previous: Task, animateRemoval: Bool) {
        guard let receipt = localStore.latestUndoEntry?.id else { return }
        let duration = FacetNativeStyle.tokens.motion.milliseconds.rowChange
        completionRows[previous.id] = FacetCompletionRow(
            previous: previous, destination: destination, receipt: receipt)
        // Keep neighboring tap targets stationary through a burst of completions.
        completionCollapseTask?.cancel()
        completionCollapseTask = _Concurrency.Task { @MainActor in
            do {
                try await _Concurrency.Task.sleep(for: .milliseconds(500))
            } catch { return }
            // Keep the checked glyph on the outgoing row throughout its removal animation.
            withAnimation(
                animateRemoval ? .easeOut(duration: duration / 1000) : nil,
                completionCriteria: .removed
            ) {
                for id in completionRows.keys { completionRows[id]?.holdsPosition = false }
            } completion: {
                self.completionRows = self.completionRows.filter { $0.value.holdsPosition }
            }
        }
    }

    internal func completionRow(for id: String) -> FacetCompletionRow? {
        guard let row = completionRows[id], row.destination == destination else { return nil }
        return row
    }

    internal var listPresentationTasks: [Task] {
        let inactive = inactiveProjectIDs
        let active = localStore.tasks.filter { !inactive.contains($0.project_id) }
        guard !completionRows.isEmpty else { return active }
        return active.map { task in
            guard !task.is_deleted, let row = completionRow(for: task.id), row.holdsPosition else {
                return task
            }
            return row.previous
        }
    }

    internal var openListPresentationTasks: [Task] {
        listPresentationTasks.filter { !$0.is_deleted && !$0.completed && $0.parent_id == nil }
    }
}
