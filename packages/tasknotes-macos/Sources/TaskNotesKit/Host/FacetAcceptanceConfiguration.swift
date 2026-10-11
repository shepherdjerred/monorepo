#if DEBUG
    public import Foundation

    /// A nonsecret launch contract. The host chooses the root; a descriptor
    /// cannot redirect the real engine or Keychain into the user's app state.
    public struct FacetAcceptanceConfiguration: Sendable, Equatable {
        public let runID: UUID
        public let stateDirectory: URL
        public let allowedRemoteVaultID: String?
        public var namespace: String {
            "red.sjer.facet.acceptance.\(runID.uuidString.lowercased())"
        }
        public var accountKeychainService: String { namespace + ".obsidian" }
        public var stagingKeychainService: String { namespace + ".vault-stages" }
        public var defaultsSuiteName: String { namespace }
        public var remoteVaultAccess: FacetRemoteVaultAccess {
            allowedRemoteVaultID.map(FacetRemoteVaultAccess.only) ?? .disabled
        }

        private struct Descriptor: Decodable {
            let schemaVersion: Int
            let runID: UUID
            let stateDirectory: String
            let allowedRemoteVaultID: String?
        }

        public func requireRemoteVault(_ id: String) throws {
            try remoteVaultAccess.requireRemoteVault(id)
        }

        public static func decode(
            _ bytes: Data, applicationSupport: URL, containerRelative: Bool = false
        ) throws
            -> FacetAcceptanceConfiguration
        {
            try FacetSchema.acceptance().validate(FacetJSON.parse(bytes), definition: "descriptor")
            let descriptor = try JSONDecoder().decode(Descriptor.self, from: bytes)
            let expected = applicationSupport.resolvingSymlinksInPath().appendingPathComponent(
                "FacetAcceptance"
            )
            .appendingPathComponent(descriptor.runID.uuidString.lowercased())
            try requirePrivateDirectories(expected)
            let virtualPath =
                "/Library/Application Support/FacetAcceptance/"
                + descriptor.runID.uuidString.lowercased()
            if containerRelative, descriptor.stateDirectory != virtualPath {
                throw FacetAcceptanceError.invalidDescriptor
            }
            let directory =
                containerRelative
                ? expected : URL(fileURLWithPath: descriptor.stateDirectory, isDirectory: true)
            guard descriptor.schemaVersion == 1, descriptor.stateDirectory.hasPrefix("/"),
                directory.standardizedFileURL.path == directory.path,
                expected.resolvingSymlinksInPath().path == expected.path,
                directory.resolvingSymlinksInPath().path == expected.path,
                descriptor.allowedRemoteVaultID.map({
                    !$0.isEmpty && $0.utf8.count <= 256
                        && !$0.unicodeScalars.contains(
                            where: CharacterSet.controlCharacters.contains)
                }) ?? true
            else { throw FacetAcceptanceError.invalidDescriptor }
            return FacetAcceptanceConfiguration(
                runID: descriptor.runID, stateDirectory: expected,
                allowedRemoteVaultID: descriptor.allowedRemoteVaultID)
        }

        private static func requirePrivateDirectories(_ directory: URL) throws {
            for candidate in [directory.deletingLastPathComponent(), directory] {
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
                    // A fresh run has not created its private directories yet.
                    continue
                }
            }
        }

        public static func launch(
            arguments: [String] = CommandLine.arguments,
            bundleID: String? = Bundle.main.bundleIdentifier,
            environment: [String: String] = ProcessInfo.processInfo.environment
        ) throws -> FacetAcceptanceConfiguration? {
            let flag = "--facet-acceptance-descriptor"
            let occurrences = arguments.indices.filter { arguments[$0] == flag }
            let local = arguments.contains("--facet-native-acceptance")
            guard !occurrences.isEmpty || local else {
                if bundleID == "red.sjer.tasknotes.mac.acceptance" {
                    throw FacetAcceptanceError.invalidDescriptor
                }
                return nil
            }
            #if os(macOS)
                guard bundleID == "red.sjer.tasknotes.mac.acceptance" else {
                    throw FacetAcceptanceError.wrongApplication
                }
            #elseif targetEnvironment(simulator)
                guard let simulatorID = environment["SIMULATOR_UDID"],
                    UUID(uuidString: simulatorID) != nil,
                    environment["FACET_E2E_SIMULATOR"] == simulatorID
                else { throw FacetAcceptanceError.wrongApplication }
            #else
                throw FacetAcceptanceError.wrongApplication
            #endif
            let support = try FileManager.default.url(
                for: .applicationSupportDirectory, in: .userDomainMask,
                appropriateFor: nil, create: true)
            guard occurrences.count == 1, let index = occurrences.first,
                arguments.indices.contains(index + 1)
            else {
                #if targetEnvironment(simulator)
                    if occurrences.isEmpty, local,
                        let device = environment["SIMULATOR_UDID"],
                        let simulatorRunID = UUID(uuidString: device)
                    {
                        return FacetAcceptanceConfiguration(
                            runID: simulatorRunID,
                            stateDirectory: support.appendingPathComponent("FacetAcceptance")
                                .appendingPathComponent(simulatorRunID.uuidString.lowercased()),
                            allowedRemoteVaultID: nil)
                    }
                #endif
                throw FacetAcceptanceError.invalidDescriptor
            }
            return try loadDescriptor(path: arguments[index + 1], support: support, local: local)
        }

        private static func loadDescriptor(path: String, support: URL, local: Bool) throws
            -> FacetAcceptanceConfiguration
        {
            #if targetEnvironment(simulator)
                if path == "@documents/acceptance.json" {
                    let documents = try FileManager.default.url(
                        for: .documentDirectory, in: .userDomainMask, appropriateFor: nil,
                        create: true)
                    let configuration = try decode(
                        Data(contentsOf: documents.appendingPathComponent("acceptance.json")),
                        applicationSupport: support, containerRelative: true)
                    guard !local || configuration.allowedRemoteVaultID == nil else {
                        throw FacetAcceptanceError.invalidDescriptor
                    }
                    return configuration
                }
            #endif
            guard path.hasPrefix("/") else { throw FacetAcceptanceError.invalidDescriptor }
            let file = URL(fileURLWithPath: path)
            let home = URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
                .resolvingSymlinksInPath()
            guard file.resolvingSymlinksInPath().path.hasPrefix(home.path + "/") else {
                throw FacetAcceptanceError.invalidDescriptor
            }
            let configuration = try decode(Data(contentsOf: file), applicationSupport: support)
            guard !local || configuration.allowedRemoteVaultID == nil else {
                throw FacetAcceptanceError.invalidDescriptor
            }
            return configuration
        }
    }
#endif
