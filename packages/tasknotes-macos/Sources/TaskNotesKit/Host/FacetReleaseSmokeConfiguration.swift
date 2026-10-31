#if os(macOS)
    public import Foundation

    /// Exercises the production Release composition without opening normal app
    /// state. Only a UUID is accepted; all paths and namespaces are host-owned.
    public struct FacetReleaseSmokeConfiguration: Sendable, Equatable {
        public let runID: UUID
        public let stateDirectory: URL
        public var namespace: String {
            "red.sjer.facet.release-smoke.\(runID.uuidString.lowercased())"
        }
        public var accountKeychainService: String { namespace + ".obsidian" }
        public var stagingKeychainService: String { namespace + ".vault-stages" }
        public var defaultsSuiteName: String { namespace }

        public static func launch(
            arguments: [String] = CommandLine.arguments,
            bundleID: String? = Bundle.main.bundleIdentifier,
            applicationSupport: URL? = nil
        ) throws -> FacetReleaseSmokeConfiguration? {
            let flag = "--facet-release-smoke"
            let occurrences = arguments.indices.filter { arguments[$0] == flag }
            guard !occurrences.isEmpty else { return nil }
            guard bundleID == "red.sjer.tasknotes.mac" else {
                throw FacetAcceptanceError.wrongApplication
            }
            guard occurrences.count == 1, let flagIndex = occurrences.first,
                arguments.indices.contains(flagIndex + 1),
                let smokeID = UUID(uuidString: arguments[flagIndex + 1]),
                !arguments.contains("--facet-acceptance-descriptor"),
                !arguments.contains("--facet-native-acceptance")
            else { throw FacetAcceptanceError.invalidDescriptor }
            let support =
                try applicationSupport
                ?? FileManager.default.url(
                    for: .applicationSupportDirectory, in: .userDomainMask,
                    appropriateFor: nil, create: true)
            let root = support.resolvingSymlinksInPath().appendingPathComponent("FacetReleaseSmoke")
            let directory = root.appendingPathComponent(smokeID.uuidString.lowercased())
            for candidate in [root, directory] {
                do {
                    let attributes = try FileManager.default.attributesOfItem(
                        atPath: candidate.path)
                    guard attributes[.type] as? FileAttributeType == .typeDirectory else {
                        throw FacetAcceptanceError.invalidDescriptor
                    }
                } catch let failure as NSError
                    where failure.domain == NSCocoaErrorDomain
                    && (failure.code == NSFileReadNoSuchFileError
                        || failure.code == NSFileNoSuchFileError)
                {
                    continue
                }
            }
            return FacetReleaseSmokeConfiguration(runID: smokeID, stateDirectory: directory)
        }

        /// Filesystem handshake: `started.<PID>` contains exactly the lowercase
        /// run UUID plus newline. Called only after production startup succeeds.
        public func recordStartup(processID: Int32 = ProcessInfo.processInfo.processIdentifier)
            throws
        {
            guard processID > 0 else { throw FacetAcceptanceError.invalidDescriptor }
            let marker = stateDirectory.appendingPathComponent("started.\(processID)")
            try Data((runID.uuidString.lowercased() + "\n").utf8).write(
                to: marker, options: .atomic)
        }
    }
#endif
