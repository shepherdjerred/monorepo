#if DEBUG
    import Foundation
    import TaskNotesKit

    /// A scalar-only receipt; no saved window state is decoded or retained.
    @MainActor
    internal final class FacetAcceptanceRestorationEvidence {
        struct Receipt: Codable, Equatable {
            let schemaVersion: Int
            let runID: UUID
            let processIdentifier: Int32
            let installationID: UUID
            let subclassInstalled: Bool
            var restoreVetoCount: UInt
        }

        private var receipt: Receipt
        private var installed = false
        private let write: (Receipt) throws -> Void

        init(
            runID: UUID, processIdentifier: Int32, installationID: UUID = UUID(),
            write: @escaping (Receipt) throws -> Void
        ) {
            receipt = Receipt(
                schemaVersion: 1, runID: runID, processIdentifier: processIdentifier,
                installationID: installationID, subclassInstalled: true, restoreVetoCount: 0)
            self.write = write
        }

        func recordInstallation() throws {
            guard !installed else { throw FacetAcceptanceError.wrongApplication }
            try write(receipt)
            installed = true
        }

        func declineRestoration(completion: () -> Void) throws -> Bool {
            guard installed else { throw FacetAcceptanceError.wrongApplication }
            var next = receipt
            let count = next.restoreVetoCount.addingReportingOverflow(1)
            guard !count.overflow else { throw FacetAcceptanceError.invalidDescriptor }
            next.restoreVetoCount = count.partialValue
            try write(next)
            receipt = next
            completion()
            return true
        }
    }
#endif
