public import Foundation
public import SwiftUI
import TaskNotesKit

/// Presentation ownership is independent of query/read generations.
public struct FacetFeedbackOrigin: Hashable, Sendable {
    public enum Surface: String, Sendable { case workspace, capture, quickAdd }
    public let id: UUID
    public let surface: Surface
    public init(id: UUID = UUID(), surface: Surface = .workspace) {
        self.id = id
        self.surface = surface
    }
}

public enum FacetFeedbackContext {
    @TaskLocal public static var origin: FacetFeedbackOrigin?
    @TaskLocal public static var intent: FacetFeedbackIntent?
}

public struct FacetFeedbackIntent: Sendable {
    let origin: FacetFeedbackOrigin?
    let activationID: UUID?
}

private struct FacetFeedbackOriginKey: EnvironmentKey {
    static let defaultValue: FacetFeedbackOrigin? = nil
}

extension EnvironmentValues {
    public var facetFeedbackOrigin: FacetFeedbackOrigin? {
        get { self[FacetFeedbackOriginKey.self] }
        set { self[FacetFeedbackOriginKey.self] = newValue }
    }
}

internal enum FacetFeedbackAction: String, Sendable {
    case created, completed, deleted, reopened, undone, saved

    static func command(_ fields: [String: FacetValue]) -> Self {
        switch fields["kind"]?.text {
        case "create": .created
        case "delete_checked": .deleted
        case "set_completion": fields["completed"] == .bool(true) ? .completed : .reopened
        case "undo": .undone
        case .some, .none: .saved
        }
    }
}

internal struct FacetFeedbackEvent: Hashable, Sendable {
    let sessionID: UUID
    let profileID: String
    let mutationID: String
    let origin: FacetFeedbackOrigin?
    let activationID: UUID?
    let action: FacetFeedbackAction
    let path: String?
    let occurrenceDate: String?
    let count: Int
    let noOp: Bool

    init(
        sessionID: UUID, profileID: String, receipt: FacetMutationReceipt,
        command: [String: FacetValue], origin: FacetFeedbackOrigin?, activationID: UUID? = nil
    ) {
        self.sessionID = sessionID
        self.profileID = profileID
        mutationID = receipt.mutationId
        self.origin = origin
        self.activationID = activationID
        path = command["path"]?.text ?? receipt.taskPath
        occurrenceDate = command["occurrenceDate"]?.text
        noOp = receipt.paths.isEmpty
        if command["kind"] == .string("batch"), let children = command["commands"]?.array?.elements
        {
            let actions = Set(
                children.compactMap { $0.object?.fields }.map(FacetFeedbackAction.command))
            action = actions.count == 1 ? actions.first ?? .saved : .saved
            count = children.count
        } else {
            action = FacetFeedbackAction.command(command)
            count = 1
        }
    }

    var message: String {
        if count > 1 {
            switch action {
            case .created: "\(count) tasks added"
            case .completed: "\(count) tasks completed"
            case .deleted: "\(count) tasks deleted"
            case .reopened: "\(count) tasks reopened"
            case .undone: "Task changes undone"
            case .saved: "\(count) tasks updated"
            }
        } else {
            switch action {
            case .created: "Task added"
            case .completed: "Task completed"
            case .deleted: "Task deleted"
            case .reopened: "Task reopened"
            case .undone: "Task change undone"
            case .saved: "Task saved"
            }
        }
    }
}
