#if os(macOS)
    public import Foundation

    public enum FacetReleaseSmokeError: Error, LocalizedError, Sendable, Equatable {
        case wrongApplication
        case invalidDescriptor

        public var errorDescription: String? {
            switch self {
            case .wrongApplication:
                "Release smoke flag was passed to an unexpected application bundle."
            case .invalidDescriptor:
                "Release smoke launch arguments or directories are invalid."
            }
        }
    }

    /// Exercises the production Release composition in an isolated Application Support directory
    /// without touching the user's real SQLite database or Keychain token.
    public struct FacetReleaseSmokeConfiguration: Sendable, Equatable {
        public let runID: UUID
        public let stateDirectory: URL

        public var namespace: String {
            "red.sjer.facet.release-smoke.\(runID.uuidString.lowercased())"
        }

        public var defaultsSuiteName: String { namespace }

        public var databaseURL: URL {
            stateDirectory.appendingPathComponent("facet-sync.sqlite3")
        }

        public static func launch(
            arguments: [String] = CommandLine.arguments,
            bundleID: String? = Bundle.main.bundleIdentifier,
            applicationSupport: URL? = nil
        ) throws -> FacetReleaseSmokeConfiguration? {
            let flag = "--facet-release-smoke"
            let occurrences = arguments.indices.filter { arguments[$0] == flag }
            guard !occurrences.isEmpty else { return nil }
            guard bundleID == "red.sjer.tasknotes.mac" else {
                throw FacetReleaseSmokeError.wrongApplication
            }
            guard occurrences.count == 1,
                let flagIndex = occurrences.first,
                arguments.indices.contains(flagIndex + 1),
                let smokeID = UUID(uuidString: arguments[flagIndex + 1])
            else {
                throw FacetReleaseSmokeError.invalidDescriptor
            }
            let support =
                try applicationSupport
                ?? FileManager.default.url(
                    for: .applicationSupportDirectory,
                    in: .userDomainMask,
                    appropriateFor: nil,
                    create: true
                )
            let root = support.resolvingSymlinksInPath().appendingPathComponent("FacetReleaseSmoke")
            let directory = root.appendingPathComponent(smokeID.uuidString.lowercased())
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
            return FacetReleaseSmokeConfiguration(runID: smokeID, stateDirectory: directory)
        }

        public func recordStartup(
            processID: Int32 = ProcessInfo.processInfo.processIdentifier
        ) throws {
            guard processID > 0 else { throw FacetReleaseSmokeError.invalidDescriptor }
            try FileManager.default.createDirectory(
                at: stateDirectory,
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
            let marker = stateDirectory.appendingPathComponent("started.\(processID)")
            let receipt = Data("\(runID.uuidString.lowercased()) \(processID)\n".utf8)
            try receipt.write(to: marker, options: .atomic)
            // The verifier may lack permission to read this app's sandbox container.
            // Launch Services supplies a private stdout descriptor for this process.
            try FileHandle.standardOutput.write(contentsOf: Data(contentsOf: marker))
        }
    }
#endif
