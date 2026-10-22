public import Foundation

public struct FacetConfiguredChoice: Identifiable, Sendable, Equatable {
    public let value: String
    public let label: String
    public let color: String?
    public let weight: Double?
    public let isConfigured: Bool
    public var configurationDiagnostic: String? {
        isConfigured
            ? nil
            : "Existing workflow value ‘\(value)’ is absent from the vault settings. "
                + "Its raw value is preserved; choose a configured value to change it."
    }
    public var id: String { value }
    public var colorDiagnostic: String? {
        guard let color, FacetConfiguredColor(color) == nil else { return nil }
        return
            "The configured color '\(color)' for \(label) is unsupported. "
            + "Choose a CSS hexadecimal color or standard named color in the vault settings."
    }

    public static func choices(
        in configuration: FacetValue, key: String, including existing: [String] = []
    ) throws -> [Self] {
        guard let values = configuration.object?.fields[key]?.array?.elements else {
            throw FacetContractError.unsupportedResponse
        }
        var result = try values.map(decode)
        for existingValue in Set(existing).sorted()
        where !result.contains(where: { $0.value == existingValue }) {
            result.append(
                Self(
                    value: existingValue, label: existingValue + " (existing value)", color: nil,
                    weight: nil,
                    isConfigured: false))
        }
        return result
    }

    private static func decode(_ item: FacetValue) throws -> Self {
        guard let fields = item.object?.fields, let rawValue = fields["value"]?.text,
            let rawLabel = fields["label"]?.text
        else { throw FacetContractError.unsupportedResponse }
        return Self(
            value: rawValue, label: rawLabel, color: try decodeColor(fields["color"]),
            weight: try decodeWeight(fields["weight"]), isConfigured: true)
    }

    private static func decodeWeight(_ field: FacetValue?) throws -> Double? {
        switch field {
        case .integer(let integer): Double(integer)
        case .unsigned(let unsigned): Double(unsigned)
        case .number(let decimal): NSDecimalNumber(decimal: decimal).doubleValue
        case .none, .null: nil
        case .rawNumber(let token):
            if let parsed = Double(token) {
                parsed
            } else {
                throw FacetContractError.unsupportedResponse
            }
        case .bool, .string, .array, .object: throw FacetContractError.unsupportedResponse
        }
    }

    private static func decodeColor(_ field: FacetValue?) throws -> String? {
        switch field {
        case .string(let rawColor): rawColor
        case .none, .null: nil
        case .bool, .integer, .unsigned, .number, .rawNumber, .array, .object:
            throw FacetContractError.unsupportedResponse
        }
    }
}

public enum FacetPresentationError: Error, LocalizedError, Sendable {
    case unsupportedColor(String)
    public var errorDescription: String? {
        switch self {
        case .unsupportedColor(let value):
            "The configured color for \(value) needs a supported hexadecimal value. Update the vault's color setting."
        }
    }
}

/// Presentation reads runtime projections without reimplementing task semantics.
public struct FacetTaskPresentation: Sendable {
    public let title: String
    public let metadata: String
    public let date: String?
    public let priority: FacetConfiguredChoice
    public let status: FacetConfiguredChoice
    public let completed: Bool
    public let recurring: Bool
    public let pending: Bool
    public let blocked: Bool

    public init(task: FacetTask, configuration: FacetValue) throws {
        guard
            let priorityChoice = try FacetConfiguredChoice.choices(
                in: configuration, key: "priorities", including: [task.priority]
            )
            .first(where: { $0.value == task.priority }),
            let statusChoice = try FacetConfiguredChoice.choices(
                in: configuration, key: "statuses", including: [task.status]
            )
            .first(where: { $0.value == task.status })
        else { throw FacetContractError.unsupportedResponse }
        title = task.title
        priority = priorityChoice
        status = statusChoice
        date = task.effectiveDate ?? task.occurrenceDate
        completed = task.completed
        recurring = task.isRecurring
        pending = task.isPending
        blocked = task.isBlocked
        let projects = Self.tokens(task.properties["projects"])
        let contexts = Self.tokens(task.properties["contexts"]).map { "@" + $0 }
        metadata = (projects + contexts).joined(separator: " · ")
    }

    public static func tokens(_ value: FacetValue?) -> [String] {
        if let text = value?.text { return [text] }
        return value?.array?.elements.compactMap(\.text) ?? []
    }
}
