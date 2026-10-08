import Foundation

/// Validate exact numeric tokens before Foundation's typed decoder. The engine
/// also validates the published neutral definition before this read seam.
internal enum FacetTrackingBoundary {
    static func validate(_ value: FacetValue) throws {
        let fields = try object(
            value,
            keys: [
                "schemaVersion", "profileId", "version", "at", "totalCount", "rows", "nextCursor",
                "problemCount", "problems",
            ])
        guard let version = fields["schemaVersion"],
            FacetJSONNumbers.compare(version, .integer(1)) == 0
        else { throw FacetContractError.unsupportedResponse }
        for key in ["version", "totalCount", "problemCount"] { try integer(fields[key]) }
        guard let rows = fields["rows"]?.array?.elements,
            let problems = fields["problems"]?.array?.elements
        else { throw FacetContractError.unsupportedResponse }
        for row in rows {
            let item = try object(
                row,
                keys: [
                    "sessionId", "taskPath", "title", "taskRevision", "startedAt", "elapsedSeconds",
                    "state", "projectLabels",
                ])
            try integer(item["elapsedSeconds"])
        }
        for problem in problems { _ = try object(problem, keys: ["taskPath", "code"]) }
        if fields["nextCursor"] != .null {
            guard let cursor = fields["nextCursor"] else {
                throw FacetContractError.unsupportedResponse
            }
            _ = try object(cursor, keys: ["taskPath", "at"])
        }
    }

    private static func object(_ value: FacetValue, keys: Set<String>) throws -> [String:
        FacetValue]
    {
        guard let fields = value.object?.fields, Set(fields.keys) == keys else {
            throw FacetContractError.unsupportedResponse
        }
        return fields
    }

    private static func integer(_ value: FacetValue?) throws {
        guard let value, FacetJSONNumbers.isInteger(value),
            let lower = FacetJSONNumbers.compare(value, .integer(0)), lower >= 0,
            let upper = FacetJSONNumbers.compare(value, .unsigned(UInt64.max)), upper <= 0
        else { throw FacetContractError.unsupportedResponse }
    }
}
