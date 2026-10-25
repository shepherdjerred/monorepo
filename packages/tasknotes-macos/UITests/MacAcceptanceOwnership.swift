import Darwin
import Foundation

/// The sandboxed test runner's Foundation home belongs to the runner, not the
/// current user's account. Resolve the POSIX owner before addressing the
/// separate acceptance app's exact container.
enum MacAcceptanceOwnership {
    private enum OwnershipError: Error { case owner, descriptor }

    static func buildDirectory(package: URL, runID: UUID, native: Bool, occurrence: Bool) -> URL {
        if native {
            return package.appendingPathComponent(
                occurrence
                    ? ".build/occurrence-acceptance/\(runID.uuidString.lowercased())/macos"
                    : ".build/acceptance-xcode")
        }
        return package.deletingLastPathComponent().appendingPathComponent(
            "tasks-for-obsidian/.build/live-sync/\(runID.uuidString.lowercased())/macos")
    }

    static func stateDirectory(runID: UUID) throws -> URL {
        try currentUserHome()
            .appendingPathComponent("Library/Containers/red.sjer.tasknotes.mac.acceptance/Data")
            .appendingPathComponent("Library/Application Support/FacetAcceptance")
            .appendingPathComponent(runID.uuidString.lowercased())
    }

    static func validate(descriptor: String, stateDirectory: String, runID: UUID) throws -> URL {
        let state = try self.stateDirectory(runID: runID)
        let expected = state.appendingPathComponent("acceptance.json")
        guard descriptor == expected.path, stateDirectory == state.path,
            expected.resolvingSymlinksInPath().path == expected.path,
            state.resolvingSymlinksInPath().path == state.path
        else { throw OwnershipError.descriptor }
        let attributes = try FileManager.default.attributesOfItem(atPath: expected.path)
        guard attributes[.type] as? FileAttributeType == .typeRegular,
            (attributes[.ownerAccountID] as? NSNumber)?.uint32Value == getuid()
        else { throw OwnershipError.descriptor }
        return state
    }

    private static func currentUserHome() throws -> URL {
        let uid = getuid()
        let size = sysconf(_SC_GETPW_R_SIZE_MAX)
        guard size > 0, size <= 1_048_576 else { throw OwnershipError.owner }
        var bytes = [CChar](repeating: 0, count: size)
        return try bytes.withUnsafeMutableBufferPointer { storage in
            var record = unsafe passwd()
            var resolved: UnsafeMutablePointer<passwd>?
            let status = unsafe getpwuid_r(
                uid, &record, storage.baseAddress, storage.count, &resolved)
            let hasRecord = unsafe resolved != nil
            let ownerUID = unsafe record.pw_uid
            guard status == 0, hasRecord, ownerUID == uid,
                let directory = unsafe record.pw_dir,
                let home = unsafe String(validatingCString: directory), home.hasPrefix("/")
            else { throw OwnershipError.owner }
            let url = URL(fileURLWithPath: home, isDirectory: true)
            guard url.resolvingSymlinksInPath().path == url.path else { throw OwnershipError.owner }
            let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
            guard attributes[.type] as? FileAttributeType == .typeDirectory,
                (attributes[.ownerAccountID] as? NSNumber)?.uint32Value == uid
            else { throw OwnershipError.owner }
            return url
        }
    }
}
