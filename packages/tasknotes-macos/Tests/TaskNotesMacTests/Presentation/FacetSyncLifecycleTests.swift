import Foundation
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

@Suite @MainActor struct FacetSyncLifecycleTests {
    @Test func retiredSessionCallbacksCannotReplaceTheStoppedState() async {
        let store = FacetStore()
        store.syncSessionGenerations["owned"] = 7
        await store.stopSessions()
        let stopped = FacetSyncStatus(transport: .stopped)
        store.syncStatuses["owned"] = stopped
        store.updateSyncState(
            profileID: "owned", state: FacetSyncStatus(transport: .connected), generation: 7)
        #expect(store.syncStatuses["owned"] == stopped)
        #expect(store.syncSessionGenerations.isEmpty)
    }

    @Test func acceptanceMessagesEncodeExplicitUnknownsAndValidateSharedSchema() throws {
        #if DEBUG
            let schema = try FacetSchema.acceptance()
            let runID = UUID()
            func check(_ value: some Encodable, definition: String) throws -> FacetValue {
                let parsed = try FacetJSON.parse(JSONEncoder().encode(value))
                try schema.validate(parsed, definition: definition)
                return parsed
            }
            let result = try check(
                FacetAcceptanceMessages.Result(
                    schemaVersion: 1, runID: runID, commandID: UUID(), outcome: "applied",
                    classification: nil),
                definition: "result")
            #expect(result.object?.fields["classification"] == .null)
            let profile = FacetAcceptanceMessages.Profile(
                profileID: "owned", profileKind: "obsidian_sync", remoteVaultID: nil,
                phase: "failed", transport: "failed", durable: nil, hostWorkPending: false)
            let snapshot = try check(
                FacetAcceptanceMessages.Snapshot(
                    runID: runID, capturedAt: "2026-10-11T12:00:00.123Z", profiles: [profile],
                    accountStage: "credentials", accountBusy: false, accountExchange: nil),
                definition: "status")
            #expect(snapshot.object?.fields["accountExchange"] == .null)
            let exported = snapshot.object?.fields["profiles"]?.array?.elements.first?.object?
                .fields
            #expect(exported?["durable"] == .null)
            #expect(exported?["remoteVaultID"] == .null)
            let diagnostic = FacetAccountExchangeDiagnostic(
                stage: .preflight, statusCode: nil, failureClassification: nil)
            let exchange = try check(diagnostic, definition: "accountExchange")
            #expect(exchange.object?.fields["statusCode"] == .null)
            #expect(exchange.object?.fields["failureClassification"] == .null)
        #endif
    }

    @Test func acceptanceSchemaRejectsUnknownCommandsAndUnsafeCounts() throws {
        #if DEBUG
            let schema = try FacetSchema.acceptance()
            let command = """
                {"schemaVersion":1,"runID":"\(UUID())","commandID":"\(UUID())","kind":"interrupt"}
                """
            #expect(throws: FacetContractError.self) {
                try schema.validate(json: command, definition: "command")
            }
            #expect(throws: FacetContractError.self) {
                try schema.validate(.unsigned(9_007_199_254_740_992), definition: "count")
            }
        #endif
    }
}
