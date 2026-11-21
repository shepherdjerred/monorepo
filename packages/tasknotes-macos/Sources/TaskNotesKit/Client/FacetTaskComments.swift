public import Foundation

extension Task {
    public var chronologicalComments: [TaskComment] {
        (comments ?? []).sorted { lhs, rhs in
            let timeA = FacetCommentDate.parse(lhs.created_at)
            let timeB = FacetCommentDate.parse(rhs.created_at)
            return timeA == timeB ? lhs.id < rhs.id : timeA < timeB
        }
    }
}

public enum FacetCommentDate {
    public static func parse(_ value: String) -> Date {
        guard let date = ViewerCalendar.parseISO8601(value)
        else {
            preconditionFailure("Invalid comment timestamp")
        }
        return date
    }
}

extension FacetLocalStore {
    internal static func commentBoundedBatch(_ commands: ArraySlice<QueuedCommand>)
        -> [QueuedCommand]
    {
        var bytes = 0
        return Array(
            commands.prefix { queued in
                if case .taskUpdate(let args) = queued.command {
                    bytes += args.append_comment?.attachment_base64?.utf8.count ?? 0
                }
                return bytes <= 24 * 1024 * 1024
            })
    }
}

extension FacetTaskPatch {
    internal var changesComments: Bool {
        appendComment != nil || removeCommentID != nil || removeAttachmentID != nil
    }

    internal func applyingCommentChanges(to existing: [TaskComment]) -> [TaskComment] {
        var result = existing.filter { $0.id != removeCommentID }
        if let note = appendComment?.comment, !result.contains(where: { $0.id == note.id }) {
            result.append(note)
        }
        if let removeAttachmentID,
            let index = result.firstIndex(where: { $0.id == removeAttachmentID })
        {
            let note = result[index]
            if note.body.isEmpty {
                result.remove(at: index)
            } else {
                result[index] = TaskComment(
                    id: note.id, body: note.body, created_at: note.created_at, file_name: nil)
            }
        }
        return result
    }
}
