import Foundation
import TaskNotesKit

/// An initialized host is published as one ready unit, never as a partial engine.
@MainActor
internal struct FacetStartupState {
    let engine: FacetEngine
    let importer: FacetVaultImporter
    let account: FacetObsidianAccount
    let pendingImports: [FacetVaultImport]
    let profiles: [FacetProfile]
    let pendingActions: [FacetPendingMutation]

    static func open(
        directory: URL,
        openEngine: @MainActor (URL) async throws -> FacetEngine = {
            try await FacetEngine.open(directory: $0)
        },
        openAccount: @MainActor (URL) async throws -> FacetObsidianAccount = {
            try await FacetObsidianAccount.open(directory: $0)
        },
        loadProfiles: @MainActor (FacetEngine) async throws -> [FacetProfile] = readProfiles,
        closeEngine: @MainActor (FacetEngine) async throws -> Void = closePreparedEngine
    ) async throws -> FacetStartupState {
        let openedEngine = try await openEngine(directory)
        do {
            let openedImporter = try FacetVaultImporter(
                directory: directory.appendingPathComponent("imports"))
            let initialImports = try await openedImporter.pending()
            let openedAccount = try await openAccount(directory.appendingPathComponent("accounts"))
            let initialProfiles = try await loadProfiles(openedEngine)
            let initialActions = try await openedEngine.pendingMutations()
            try _Concurrency.Task.checkCancellation()
            return FacetStartupState(
                engine: openedEngine, importer: openedImporter, account: openedAccount,
                pendingImports: initialImports, profiles: initialProfiles,
                pendingActions: initialActions)
        } catch {
            let primary = error
            do { try await closeEngine(openedEngine) } catch {
                throw FacetStartupFailure(primary: primary, cleanup: error)
            }
            throw primary
        }
    }

    private static func readProfiles(_ prepared: FacetEngine) async throws -> [FacetProfile] {
        try await prepared.profiles()
    }

    private static func closePreparedEngine(_ prepared: FacetEngine) async throws {
        try await prepared.close()
    }
}

internal struct FacetStartupFailure: Error, CustomNSError {
    let primary: any Error
    let cleanup: any Error
    static var errorDomain: String { "Facet.Startup" }
    var errorCode: Int { 1 }
    var errorUserInfo: [String: Any] {
        [NSUnderlyingErrorKey: primary, NSMultipleUnderlyingErrorsKey: [cleanup]]
    }
}
