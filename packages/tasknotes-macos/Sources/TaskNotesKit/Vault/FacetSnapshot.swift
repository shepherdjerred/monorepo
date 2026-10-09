/// Presentation projections of the runtime's language-neutral JSON contract.
/// Task behavior and property semantics remain in Rust.
public import Foundation

public struct FacetProfile: Codable, Identifiable, Sendable {
    public let schemaVersion: UInt32
    public let id: String
    public let name: String
    public let kind: String
    public let approveStandard: Bool

    public init(id: String, name: String, kind: String, approveStandard: Bool) {
        self.schemaVersion = 1
        self.id = id
        self.name = name
        self.kind = kind
        self.approveStandard = approveStandard
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, id, name, kind, approveStandard
    }
    public init(from decoder: any Decoder) throws {
        let value = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try value.decodeIfPresent(UInt32.self, forKey: .schemaVersion) ?? 1
        id = try value.decode(String.self, forKey: .id)
        name = try value.decode(String.self, forKey: .name)
        kind = try value.decode(String.self, forKey: .kind)
        approveStandard = try value.decode(Bool.self, forKey: .approveStandard)
    }
}

public struct FacetTask: Codable, Identifiable, Sendable {
    public let id: String
    public let path: String
    public let title: String
    public let status: String
    public let priority: String
    public let completed: Bool
    public let revision: String
    public let properties: [String: FacetValue]
    public let body: String
    public let isRecurring: Bool
    public let isBlocked: Bool
    public let isBlocking: Bool
    public let occurrenceDate: String?
    public let effectiveDate: String?
    public let isPending: Bool
}

public struct FacetProblem: Codable, Sendable {
    public let path: String
    public let message: String
}

public struct FacetSnapshot: Codable, Sendable {
    public let schemaVersion: UInt32
    public let profileId: String
    public let version: UInt64
    public let tasks: [FacetTask]
    public let totalCount: UInt64
    public let pendingCount: Int
    public let pendingTaskIds: [String]
    public let conflictCount: Int
    public let configuration: FacetValue
    public let problems: [FacetProblem]
    public let views: [FacetSavedView]
    public let groups: [FacetTaskGroup]

    public func appending(_ page: FacetSnapshot) throws -> FacetSnapshot {
        guard profileId == page.profileId, version == page.version,
            Set(tasks.map(\.rowID)).isDisjoint(with: page.tasks.map(\.rowID))
        else { throw FacetContractError.unsupportedResponse }
        var groups = self.groups
        for group in page.groups {
            if let index = groups.firstIndex(where: { $0.key == group.key }) {
                groups[index] = FacetTaskGroup(
                    key: group.key, taskIds: groups[index].taskIds + group.taskIds)
            } else {
                groups.append(group)
            }
        }
        return FacetSnapshot(
            schemaVersion: schemaVersion, profileId: profileId, version: version,
            tasks: tasks + page.tasks, totalCount: page.totalCount, pendingCount: page.pendingCount,
            pendingTaskIds: page.pendingTaskIds, conflictCount: page.conflictCount,
            configuration: page.configuration, problems: page.problems, views: page.views,
            groups: groups)
    }
}

public struct FacetSavedView: Codable, Identifiable, Sendable {
    public let id: String
    public let view: [String: FacetValue]
    public let revision: String
}

public struct FacetTaskGroup: Codable, Sendable {
    public let key: String
    public let taskIds: [String]
}

public struct FacetConflict: Codable, Identifiable, Sendable {
    public let id: String
    public let path: String
    public let base: FacetVersionMetadata?
    public let local: FacetVersionMetadata?
    public let remote: FacetVersionMetadata?
    public let remoteRevision: String
    public let currentRevision: String?
}

public struct FacetVersionMetadata: Codable, Sendable {
    public let size: UInt64
    public let revision: String
}

public struct FacetConflictPage: Codable, Sendable {
    public let schemaVersion: UInt32
    public let conflicts: [FacetConflict]
    public let nextCursor: String?
}

public indirect enum FacetValue: Codable, Equatable, Sendable {
    case null
    case bool(Bool)
    case integer(Int64)
    case unsigned(UInt64)
    case number(Decimal)
    case string(String)
    case rawNumber(String)
    case array([FacetValue])
    case object([String: FacetValue])

    public init(from decoder: any Decoder) throws {
        if let exact = decoder.userInfo[try FacetJSON.documentKey()] as? FacetValue {
            self = try Self.descendant(exact, path: decoder.codingPath)
            return
        }
        let value = try decoder.singleValueContainer()
        if value.decodeNil() {
            self = .null
        } else if let boolean = try Self.decodeType(Bool.self, value) {
            self = .bool(boolean)
        } else if let number = try Self.decodeType(Decimal.self, value) {
            let numericText = NSDecimalNumber(decimal: number).stringValue
            if let integer = Int64(numericText) {
                self = .integer(integer)
            } else if let unsigned = UInt64(numericText) {
                self = .unsigned(unsigned)
            } else {
                self = .number(number)
            }
        } else if let string = try Self.decodeType(String.self, value) {
            self = .string(string)
        } else if let decodedArray = try Self.decodeType([FacetValue].self, value) {
            self = .array(decodedArray)
        } else {
            self = .object(try value.decode([String: FacetValue].self))
        }
    }

    private static func descendant(_ document: FacetValue, path: [any CodingKey]) throws
        -> FacetValue
    {
        var selected = document
        for component in path {
            if let index = component.intValue, let items = selected.array?.elements {
                guard items.indices.contains(index) else {
                    throw FacetContractError.unsupportedResponse
                }
                selected = items[index]
            } else if let child = selected.object?.fields[component.stringValue] {
                selected = child
            } else {
                throw FacetContractError.unsupportedResponse
            }
        }
        return selected
    }

    private static func decodeType<Value: Decodable>(
        _ type: Value.Type, _ container: any SingleValueDecodingContainer
    ) throws -> Value? {
        do { return try container.decode(type) } catch DecodingError.typeMismatch { return nil }
    }

    public func encode(to encoder: any Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case .null: try value.encodeNil()
        case .bool(let item): try value.encode(item)
        case .integer(let item): try value.encode(item)
        case .unsigned(let item): try value.encode(item)
        case .number(let item): try value.encode(item)
        case .rawNumber:
            throw EncodingError.invalidValue(
                self,
                .init(
                    codingPath: encoder.codingPath,
                    debugDescription: "Use the exact Facet JSON encoder for open numeric fields."))
        case .string(let item): try value.encode(item)
        case .array(let items): try value.encode(items)
        case .object(let items): try value.encode(items)
        }
    }

    public var text: String? { if case .string(let value) = self { value } else { nil } }
    public var object: FacetObjectProjection? {
        if case .object(let value) = self { FacetObjectProjection(fields: value) } else { nil }
    }
    public var array: FacetArrayProjection? {
        if case .array(let value) = self { FacetArrayProjection(elements: value) } else { nil }
    }
}

public struct FacetObjectProjection: Sendable, Equatable {
    public let fields: [String: FacetValue]
}

public struct FacetArrayProjection: Sendable, Equatable {
    public let elements: [FacetValue]
}
