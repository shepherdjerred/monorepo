import Foundation
import TaskNotesUniFFI

extension FacetEngine {
    public func conflicts(profileID: String) throws -> [FacetConflict] {
        try conflictPage(profileID: profileID, afterID: nil).conflicts
    }

    public func conflictPage(profileID: String, afterID: String?) throws -> FacetConflictPage {
        let json = try engine.conflictsPageJson(profileId: profileID, afterId: afterID, limit: 128)
        try schema.validate(json: json, definition: "conflicts")
        let response: FacetConflictPage = try decode(json)
        guard response.schemaVersion == 1 else { throw FacetContractError.unsupportedResponse }
        return response
    }
}
