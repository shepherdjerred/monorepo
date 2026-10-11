#if DEBUG
    import Foundation
    import TaskNotesKit

    /// Private, descriptor-confined control for real acceptance sessions.
    /// Release builds contain neither the watcher nor its command interface.
    internal final class FacetAcceptanceControl {
        private typealias Command = FacetAcceptanceMessages.Command
        private typealias Result = FacetAcceptanceMessages.Result
        private typealias InterruptionState = FacetAcceptanceMessages.InterruptionState
        private typealias Profile = FacetAcceptanceMessages.Profile
        private typealias Snapshot = FacetAcceptanceMessages.Snapshot
        private weak var store: FacetStore?
        private let configuration: FacetAcceptanceConfiguration
        private let directory: URL
        private var interrupted: Set<String>
        private var consumedCommandIDs: Set<UUID> = []
        private let schema: FacetSchema
        private var worker: _Concurrency.Task<Void, Never>?

        init(store: FacetStore, configuration: FacetAcceptanceConfiguration) throws {
            self.store = store
            self.configuration = configuration
            schema = try FacetSchema.acceptance()
            directory = configuration.stateDirectory.appendingPathComponent(
                "control", isDirectory: true)
            try FileManager.default.createDirectory(
                at: directory, withIntermediateDirectories: true)
            let interruptionURL = directory.appendingPathComponent("interruption.json")
            if FileManager.default.fileExists(atPath: interruptionURL.path) {
                let bytes = try Data(contentsOf: interruptionURL)
                try schema.validate(data: bytes, definition: "interruption")
                let state = try JSONDecoder().decode(InterruptionState.self, from: bytes)
                guard state.schemaVersion == 1, state.runID == configuration.runID else {
                    throw FacetContractError.unsupportedResponse
                }
                interrupted = state.profileIDs
            } else {
                interrupted = []
            }
            let ledgerURL = directory.appendingPathComponent("ledger.json")
            if FileManager.default.fileExists(atPath: ledgerURL.path) {
                let bytes = try Data(contentsOf: ledgerURL)
                try schema.validate(data: bytes, definition: "ledger")
                let ledger = try JSONDecoder().decode(
                    FacetAcceptanceMessages.Ledger.self, from: bytes)
                guard ledger.runID == configuration.runID else {
                    throw FacetContractError.unsupportedResponse
                }
                consumedCommandIDs = ledger.commandIDs
            }
        }

        func start() {
            guard worker == nil else { return }
            worker = _Concurrency.Task { [weak self] in
                do {
                    while !_Concurrency.Task.isCancelled {
                        guard let self, self.store != nil else { return }
                        try await self.poll()
                        try await _Concurrency.Task.sleep(for: .milliseconds(250))
                    }
                } catch is CancellationError {} catch {
                    self?.store?.reportNativeFailure(error)
                }
            }
        }

        func stop() {
            worker?.cancel()
            worker = nil
        }

        func isInterrupted(profileID: String) -> Bool { interrupted.contains(profileID) }

        internal func poll() async throws {
            guard let store else { return }
            let commandURL = directory.appendingPathComponent("command.json")
            if FileManager.default.fileExists(atPath: commandURL.path) {
                let bytes = try Data(contentsOf: commandURL)
                try schema.validate(data: bytes, definition: "command")
                let command = try JSONDecoder().decode(Command.self, from: bytes)
                if !consumedCommandIDs.contains(command.commandID) {
                    let result: Result
                    do {
                        guard command.schemaVersion == 1, command.runID == configuration.runID
                        else {
                            throw FacetContractError.unsupportedResponse
                        }
                        try await apply(command, store: store)
                        result = Result(
                            schemaVersion: 1, runID: configuration.runID,
                            commandID: command.commandID,
                            outcome: "applied", classification: nil)
                    } catch {
                        result = Result(
                            schemaVersion: 1, runID: configuration.runID,
                            commandID: command.commandID,
                            outcome: "rejected",
                            classification: FacetFailureDiagnostic(error).classification)
                    }
                    try write(result, name: "result.json")
                    consumedCommandIDs.insert(command.commandID)
                    try write(
                        FacetAcceptanceMessages.Ledger(
                            schemaVersion: 1, runID: configuration.runID,
                            commandIDs: consumedCommandIDs),
                        name: "ledger.json")
                }
            }
            try await exportStatus(store: store)
        }

        private func apply(_ command: Command, store: FacetStore) async throws {
            switch command.kind {
            case .refresh: await store.refresh()
            case .interrupt, .resume:
                guard let profileID = command.profileID else {
                    throw FacetContractError.unsupportedResponse
                }
                let shouldInterrupt = command.kind == .interrupt
                // Validate before persisting the intent. On restart this intent
                // is applied before core.begin can open a socket.
                _ = try await store.acceptanceRemoteVault(profileID: profileID)
                if shouldInterrupt {
                    interrupted.insert(profileID)
                } else {
                    interrupted.remove(profileID)
                }
                try write(
                    InterruptionState(
                        schemaVersion: 1, runID: configuration.runID, profileIDs: interrupted),
                    name: "interruption.json")
                try await store.setAcceptanceTransportInterrupted(
                    shouldInterrupt, profileID: profileID)
            }
        }

        private func exportStatus(store: FacetStore) async throws {
            let connections = await store.account?.connections() ?? []
            var profiles: [Profile] = []
            for profile in store.profiles {
                let state: FacetSyncStatus
                do {
                    if let session = store.sessions[profile.id] {
                        state = try await session.currentAcceptanceStatus()
                    } else {
                        let durable = try await store.engine?.syncStatus(profileID: profile.id)
                        state = FacetSyncStatus(
                            transport: store.syncStatuses[profile.id]?.transport ?? .stopped,
                            durable: durable)
                    }
                } catch { state = FacetSyncStatus(transport: .failed) }
                profiles.append(
                    Profile(
                        profileID: profile.id, profileKind: profile.kind,
                        remoteVaultID: connections.first { $0.profileID == profile.id }?.vaultID,
                        phase: state.phase.rawValue, transport: state.transport.rawValue,
                        durable: state.durable, hostWorkPending: !state.work.isEmpty))
            }
            let stage: String
            switch store.accountPresentation.stage {
            case .credentials: stage = "credentials"
            case .verification: stage = "verification"
            case .vaults: stage = "vaults"
            }
            try write(
                Snapshot(
                    runID: configuration.runID,
                    capturedAt: Date().ISO8601Format(
                        .iso8601.year().month().day().time(includingFractionalSeconds: true)
                            .timeZone(separator: .colon)),
                    profiles: profiles, accountStage: stage,
                    accountBusy: store.accountPresentation.isBusy,
                    accountExchange: await store.account?.lastExchangeDiagnostic),
                name: "status.json")
        }

        private func write(_ value: some Encodable, name: String) throws {
            let data = try JSONEncoder().encode(value)
            try schema.validate(data: data, definition: String(name.dropLast(5)))
            try data.write(to: directory.appendingPathComponent(name), options: .atomic)
        }
    }

    extension FacetStore {
        internal func startAcceptanceControl() {
            guard let acceptanceConfiguration, acceptanceControl == nil else { return }
            do {
                acceptanceControl = try FacetAcceptanceControl(
                    store: self, configuration: acceptanceConfiguration)
                acceptanceControl?.start()
            } catch { reportNativeFailure(error) }
        }

        public func stopAcceptanceControl() {
            acceptanceControl?.stop()
            acceptanceControl = nil
        }

        internal func acceptanceRemoteVault(profileID: String) async throws -> String {
            guard let configuration = acceptanceConfiguration,
                let connection = await account?.connections().first(where: {
                    $0.profileID == profileID
                })
            else { throw FacetSyncError.cancelled }
            try configuration.requireRemoteVault(connection.vaultID)
            return connection.vaultID
        }

        public func setAcceptanceTransportInterrupted(_ interrupted: Bool, profileID: String)
            async throws
        {
            let vaultID = try await acceptanceRemoteVault(profileID: profileID)
            guard let session = sessions[profileID] else { throw FacetSyncError.cancelled }
            try await session.setAcceptanceTransportInterrupted(
                interrupted, allowedVaultID: vaultID)
        }

        internal func prepareAcceptanceInterruption(
            _ session: FacetObsidianSession, profileID: String
        )
            async throws
        {
            guard acceptanceConfiguration != nil else { return }
            // Controller initialization must precede any resumed session.
            startAcceptanceControl()
            guard let acceptanceControl else { throw FacetContractError.unsupportedResponse }
            if acceptanceControl.isInterrupted(profileID: profileID) {
                let vaultID = try await acceptanceRemoteVault(profileID: profileID)
                try await session.prepareAcceptanceTransportInterruption(allowedVaultID: vaultID)
            }
        }
    }
#endif
