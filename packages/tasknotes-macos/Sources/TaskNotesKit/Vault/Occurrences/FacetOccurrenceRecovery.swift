import Foundation

internal enum FacetOccurrenceRecovery {
    static func resume(
        admission: FacetOccurrenceAdmission,
        pending: (String?) throws -> [FacetPendingMutation],
        retry: (String) throws -> Void,
        retire: (FacetPendingMutation) throws -> Void,
        observe: (String) throws -> Void
    ) throws {
        var cursor: String?
        while true {
            try admission.requireAdmission()
            let page = try pending(cursor)
            for saved in page {
                try admission.requireAdmission()
                let command = saved.mutation.object?.fields["command"]?.object?.fields
                guard command?["kind"] == .string("materialize_occurrence_window"),
                    command?["origin"] == .string("automatic_maintenance")
                else { continue }
                try _Concurrency.Task.checkCancellation()
                do { try retry(saved.id) } catch {
                    // Ownership loss does not authorize retirement of the exact
                    // envelope. A later valid owner can observe or resume it.
                    try admission.requireAdmission()
                    try retire(saved)
                    continue
                }
                try observe(saved.id)
            }
            guard page.count == 128, let last = page.last else { return }
            cursor = last.id
        }
    }
}
