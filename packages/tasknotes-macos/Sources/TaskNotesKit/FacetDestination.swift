/// Built-in Todoist-style navigation sections in the Facet workspace.
public enum FacetSection: String, CaseIterable, Codable, Sendable, Equatable, Hashable {
    case inbox
    case today
    case upcoming
    case completed

    public var title: String {
        switch self {
        case .inbox: "Inbox"
        case .today: "Today"
        case .upcoming: "Upcoming"
        case .completed: "Completed"
        }
    }

    public var systemImage: String {
        switch self {
        case .inbox: "tray"
        case .today: "star"
        case .upcoming: "calendar"
        case .completed: "checkmark.circle"
        }
    }
}

/// Primary sidebar or tab destination in Facet.
public enum FacetDestination: Codable, Sendable, Equatable, Hashable, Identifiable {
    case section(FacetSection)
    case board
    case project(id: String)
    case label(id: String)
    case filter(id: String)

    public var id: String { identity }

    public var identity: String {
        switch self {
        case .section(let value):
            value.rawValue
        case .board:
            "kanban"
        case .project(let projectId):
            "project.\(projectId)"
        case .label(let labelId):
            "label.\(labelId)"
        case .filter(let filterId):
            "filter.\(filterId)"
        }
    }
}

/// Deep-link command actions that trigger UI presentation rather than a list scope.
public enum FacetURLAction: String, CaseIterable, Codable, Sendable, Equatable, Hashable {
    case quickAdd = "quick-add"
    case queuedCapture = "queued-capture"
    case search
    case settings
}
