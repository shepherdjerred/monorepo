public struct FacetDependencyEditor: Decodable, Sendable {
    public let schemaVersion: UInt32
    public let relationshipTypes: [FacetDependencyRelationship]
    public let defaultReltype: FacetDependencyRelationship?

    public var newDependency: FacetValue {
        .object([
            "uid": .string(""), "reltype": .string(defaultReltype?.rawValue ?? ""),
        ])
    }
}

/// Labels describe the neutral contract; only the engine's returned array supplies choices.
public enum FacetDependencyRelationship: String, Decodable, Sendable {
    case finishToStart = "FINISHTOSTART"
    case startToStart = "STARTTOSTART"
    case finishToFinish = "FINISHTOFINISH"
    case startToFinish = "STARTTOFINISH"

    public var label: String {
        switch self {
        case .finishToStart: "Finish to start"
        case .startToStart: "Start to start"
        case .finishToFinish: "Finish to finish"
        case .startToFinish: "Start to finish"
        }
    }
}
