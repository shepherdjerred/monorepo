public import Foundation

/// Parsed target of a `tasknotes://` deep link.
public enum FacetURLTarget: Sendable, Equatable, Hashable {
    case destination(FacetDestination)
    case task(id: String)
    case action(FacetURLAction)
}

/// Validated `tasknotes://` deep-link parser and builder shared across macOS and iOS.
public struct TaskNotesURL: Sendable, Equatable, Hashable {
    public static let scheme = "tasknotes"

    public let target: FacetURLTarget

    public init(_ target: FacetURLTarget) {
        self.target = target
    }

    public init?(_ url: URL) {
        guard url.scheme?.lowercased() == Self.scheme else { return nil }
        guard let host = url.host()?.lowercased() else { return nil }
        let component = Self.singleComponent(of: url)
        guard let parsed = Self.resolve(host: host, component: component) else { return nil }
        self.target = parsed
    }

    public var url: URL {
        switch target {
        case .destination(let destination):
            Self.url(for: destination)
        case .task(let taskId):
            Self.build(host: "task", component: taskId)
        case .action(let action):
            Self.build(host: action.rawValue, component: nil)
        }
    }

    private static func resolve(host: String, component: String?) -> FacetURLTarget? {
        if let component {
            guard !component.isEmpty,
                !component.contains(".."),
                !component.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
            else { return nil }
            if host == "task" { return .task(id: component) }
            if host == "project" { return .destination(.project(id: component)) }
            if host == "label" || host == "tag" { return .destination(.label(id: component)) }
            if host == "view" || host == "filter" { return .destination(.filter(id: component)) }
            return nil
        }

        if let section = FacetSection(rawValue: host) {
            return .destination(.section(section))
        }
        if host == "kanban" || host == "board" {
            return .destination(.board)
        }
        if let action = FacetURLAction(rawValue: host) {
            return .action(action)
        }
        return nil
    }

    private static func url(for destination: FacetDestination) -> URL {
        switch destination {
        case .section(let section):
            build(host: section.rawValue, component: nil)
        case .board:
            build(host: "kanban", component: nil)
        case .project(let projectId):
            build(host: "project", component: projectId)
        case .label(let labelId):
            build(host: "label", component: labelId)
        case .filter(let filterId):
            build(host: "view", component: filterId)
        }
    }

    private static func singleComponent(of url: URL) -> String? {
        let raw = url.path(percentEncoded: true)
        guard raw.hasPrefix("/") else { return nil }
        let parts = raw.dropFirst().split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 1, let only = parts.first else { return nil }
        return String(only).removingPercentEncoding
    }

    private static func build(host: String, component: String?) -> URL {
        var text = "\(scheme)://\(host)"
        if let component {
            var allowed = CharacterSet.urlPathAllowed
            allowed.remove(charactersIn: "/")
            guard let encoded = component.addingPercentEncoding(withAllowedCharacters: allowed)
            else {
                preconditionFailure("tasknotes:// link component could not be encoded")
            }
            text += "/\(encoded)"
        }
        guard let built = URL(string: text) else {
            preconditionFailure("tasknotes:// link is not a valid URL: \(text)")
        }
        return built
    }
}
