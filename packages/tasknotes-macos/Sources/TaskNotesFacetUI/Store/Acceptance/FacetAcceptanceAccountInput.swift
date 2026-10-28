#if DEBUG && os(iOS) && targetEnvironment(simulator)
    import Foundation
    import TaskNotesKit

    /// Test-only delivery into the already mounted normal form, never an authentication API.
    @MainActor
    internal final class FacetAcceptanceAccountInput {
        private let peer: FacetAcceptanceAccountPeer
        private var worker: _Concurrency.Task<Void, Never>?

        private init(peer: FacetAcceptanceAccountPeer) { self.peer = peer }

        internal static func start(
            configuration: FacetAcceptanceConfiguration?,
            formEpoch: UUID,
            stage: @escaping FacetAcceptanceAccountPeer.Stage,
            apply: @escaping FacetAcceptanceAccountPeer.Apply
        ) throws -> FacetAcceptanceAccountInput? {
            let environment = ProcessInfo.processInfo.environment
            guard
                [
                    "FACET_E2E_ACCOUNT_SOCKET", "FACET_E2E_ACCOUNT_HELPER_PID",
                    "FACET_E2E_ACCOUNT_SESSION",
                ].contains(where: { environment[$0] != nil })
            else { return nil }
            guard let boundConfiguration = configuration,
                let endpoint = environment["FACET_E2E_ACCOUNT_SOCKET"],
                let rawPID = environment["FACET_E2E_ACCOUNT_HELPER_PID"],
                let pid = Int32(rawPID), pid > 0,
                let session = environment["FACET_E2E_ACCOUNT_SESSION"],
                UUID(uuidString: session) != nil,
                let run = environment["FACET_E2E_RUN_ID"],
                UUID(uuidString: run) == boundConfiguration.runID,
                let device = environment["SIMULATOR_UDID"], UUID(uuidString: device) != nil,
                environment["FACET_E2E_SIMULATOR"]?.lowercased() == device.lowercased(),
                Bundle.main.bundleIdentifier == "org.reactjs.native.example.TasksForObsidian",
                endpoint == "/private/tmp/facet-account-\(session.lowercased())/input.sock",
                let protocolURL = Bundle.main.url(
                    forResource: "account-input.schema", withExtension: "json")
            else { throw FacetAcceptanceAccountPeer.Failure.boundary }
            let selectedPeer = try FacetAcceptanceAccountPeer(
                identity: [
                    "sessionID": session.lowercased(), "runID": run.lowercased(),
                    "deviceID": device.lowercased(),
                ],
                endpoint: endpoint, helperPID: pid, formEpoch: formEpoch,
                schema: Data(contentsOf: protocolURL))
            let input = FacetAcceptanceAccountInput(peer: selectedPeer)
            input.worker = _Concurrency.Task {
                do { try await selectedPeer.run(stage: stage, apply: apply) } catch {
                    // A closed peer is the only error signal; no input or UI hierarchy is logged.
                }
                await selectedPeer.stop()
            }
            return input
        }

        internal func stop() {
            worker?.cancel()
            worker = nil
            let owned = peer
            _Concurrency.Task { await owned.stop() }
        }
    }
#endif
