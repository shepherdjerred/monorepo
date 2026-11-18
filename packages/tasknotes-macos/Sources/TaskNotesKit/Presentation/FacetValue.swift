public import Foundation

/// Contract validation error thrown when a bundled or persisted JSON resource violates its schema.
public enum FacetContractError: Error, LocalizedError, Sendable, Equatable {
    case unsupportedResponse

    public var errorDescription: String? {
        switch self {
        case .unsupportedResponse:
            "A Facet contract or schema resource failed validation."
        }
    }
}

/// Lossless JSON value representation used for strict JSON Schema validation.
public enum FacetValue: Sendable, Equatable {
    public struct ObjectValue: Sendable, Equatable {
        public let fields: [String: FacetValue]

        public init(_ fields: [String: FacetValue]) {
            self.fields = fields
        }
    }

    public struct ArrayValue: Sendable, Equatable {
        public let elements: [FacetValue]

        public init(_ elements: [FacetValue]) {
            self.elements = elements
        }
    }

    case null
    case bool(Bool)
    case integer(Int64)
    case unsigned(UInt64)
    case number(Decimal)
    case rawNumber(String)
    case string(String)
    case array([FacetValue])
    case object([String: FacetValue])

    public var text: String? {
        if case .string(let value) = self {
            return value
        }
        return nil
    }

    public var object: ObjectValue? {
        if case .object(let fields) = self {
            return ObjectValue(fields)
        }
        return nil
    }

    public var array: ArrayValue? {
        if case .array(let items) = self {
            return ArrayValue(items)
        }
        return nil
    }
}
