#if DEBUG
    import Foundation
    import Testing

    @testable import TaskNotesKit
    @testable import TaskNotesMac

    @Suite("Early acceptance restoration bootstrap") @MainActor
    struct FacetEarlyRestorationTests {
        @Test func productionDoesNotValidateOrInitializeAnApplication() throws {
            try FacetMacApplicationBootstrap.install(bundleID: "red.sjer.tasknotes.mac") {
                Issue.record("Production must not read an acceptance descriptor.")
                throw FacetAcceptanceError.invalidDescriptor
            } initialize: { _ in
                Issue.record("Production must retain its original app startup.")
            }
        }

        @Test func invalidAcceptanceCannotInitializeAnApplication() {
            #expect(throws: FacetAcceptanceError.self) {
                try FacetMacApplicationBootstrap.install(
                    bundleID: "red.sjer.tasknotes.mac.acceptance", acceptance: { nil },
                    initialize: { _ in
                        Issue.record("Missing configuration must fail before initialization.")
                    })
            }
            #expect(throws: FacetAcceptanceError.self) {
                try FacetMacApplicationBootstrap.install(
                    bundleID: "red.sjer.tasknotes.mac.acceptance",
                    acceptance: { throw FacetAcceptanceError.invalidDescriptor },
                    initialize: { _ in
                        Issue.record("Invalid configuration must fail before initialization.")
                    })
            }
        }

        @Test func validatedConfigurationPrecedesInitialization() throws {
            let configuration = FacetAcceptanceConfiguration(
                runID: UUID(), stateDirectory: URL(fileURLWithPath: "/synthetic"),
                allowedRemoteVaultID: nil)
            var order: [String] = []
            try FacetMacApplicationBootstrap.install(
                bundleID: "red.sjer.tasknotes.mac.acceptance"
            ) {
                order.append("validate")
                return configuration
            } initialize: { received in
                #expect(received == configuration)
                order.append("initialize")
            }
            #expect(order == ["validate", "initialize"])
        }

        @Test func scalarEvidencePrecedesEachExactlyOnceCompletion() throws {
            let runID = UUID()
            let installationID = UUID()
            var retained: [FacetAcceptanceRestorationEvidence.Receipt] = []
            let evidence = FacetAcceptanceRestorationEvidence(
                runID: runID, processIdentifier: 42, installationID: installationID,
                write: { retained.append($0) })
            var completed = 0
            #expect(throws: FacetAcceptanceError.self) {
                try evidence.declineRestoration { completed += 1 }
            }
            #expect(completed == 0)
            try evidence.recordInstallation()
            for count in 1...22 {
                let recognized = try evidence.declineRestoration {
                    #expect(retained.last?.restoreVetoCount == UInt(count))
                    completed += 1
                }
                #expect(recognized)
            }
            #expect(completed == 22)
            #expect(retained.count == 23)
            #expect(retained.first?.restoreVetoCount == 0)
            #expect(
                retained.allSatisfy {
                    $0.schemaVersion == 1 && $0.runID == runID && $0.processIdentifier == 42
                        && $0.installationID == installationID && $0.subclassInstalled
                })
            #expect(throws: FacetAcceptanceError.self) { try evidence.recordInstallation() }
        }

        @Test func failedEvidenceCannotReportSuccessfulRestorationCompletion() throws {
            var retained: [FacetAcceptanceRestorationEvidence.Receipt] = []
            var fail = true
            let evidence = FacetAcceptanceRestorationEvidence(runID: UUID(), processIdentifier: 42)
            {
                guard !fail else { throw FacetAcceptanceError.invalidDescriptor }
                retained.append($0)
            }
            #expect(throws: FacetAcceptanceError.self) { try evidence.recordInstallation() }
            #expect(retained.isEmpty)
            fail = false
            try evidence.recordInstallation()
            fail = true
            var completed = false
            #expect(throws: FacetAcceptanceError.self) {
                try evidence.declineRestoration { completed = true }
            }
            #expect(!completed)
            #expect(retained.map(\.restoreVetoCount) == [0])
        }
    }
#endif
