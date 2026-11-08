import AppKit
import Foundation
import TaskNotesKit

/// Runs before SwiftUI constructs its App or application-delegate adaptor.
@MainActor
public enum FacetMacApplicationBootstrap {
    public static func prepare() {
        #if DEBUG
            do {
                try install(bundleID: Bundle.main.bundleIdentifier) {
                    try FacetAcceptanceConfiguration.launch()
                } initialize: { configuration in
                    guard NSApp == nil else { throw FacetAcceptanceError.wrongApplication }
                    guard
                        let application = FacetAcceptanceApplication.shared
                            as? FacetAcceptanceApplication
                    else { throw FacetAcceptanceError.wrongApplication }
                    try application.installEvidence(configuration)
                }
            } catch {
                preconditionFailure("Acceptance restoration bootstrap could not be installed.")
            }
        #endif
    }

    #if DEBUG
        internal static func install(
            bundleID: String?, acceptance: () throws -> FacetAcceptanceConfiguration?,
            initialize: (FacetAcceptanceConfiguration) throws -> Void
        ) throws {
            guard
                let configuration = try FacetWorkspaceRestorationPolicy.configuration(
                    bundleID: bundleID, acceptance: acceptance)
            else { return }
            try initialize(configuration)
        }
    #endif
}

#if DEBUG
    @MainActor
    internal final class FacetAcceptanceApplication: NSApplication {
        private var evidence: FacetAcceptanceRestorationEvidence?
        private let initialWorkspace = FacetAcceptanceInitialWorkspace()

        func installEvidence(_ configuration: FacetAcceptanceConfiguration) throws {
            guard evidence == nil else { throw FacetAcceptanceError.wrongApplication }
            let installedEvidence = FacetAcceptanceRestorationEvidence(
                runID: configuration.runID,
                processIdentifier: ProcessInfo.processInfo.processIdentifier
            ) { receipt in
                let directory = configuration.stateDirectory
                let destination = directory.appendingPathComponent("workspace-restoration.json")
                guard directory.resolvingSymlinksInPath() == directory,
                    destination.resolvingSymlinksInPath() == destination
                else { throw FacetAcceptanceError.invalidDescriptor }
                try FileManager.default.createDirectory(
                    at: directory, withIntermediateDirectories: true,
                    attributes: [.posixPermissions: 0o700])
                try JSONEncoder().encode(receipt).write(to: destination, options: .atomic)
            }
            try installedEvidence.recordInstallation()
            evidence = installedEvidence
            NotificationCenter.default.addObserver(
                self, selector: #selector(restorationDidFinish),
                name: NSApplication.didFinishRestoringWindowsNotification, object: self)
        }

        override func finishLaunching() {
            super.finishLaunching()
            receiveInitialWorkspaceEvent(.launchFinished)
        }

        @objc private func restorationDidFinish(_ notification: Notification) {
            guard let application = notification.object as? FacetAcceptanceApplication,
                application === self
            else { return }
            receiveInitialWorkspaceEvent(.restorationFinished)
        }

        private func receiveInitialWorkspaceEvent(_ event: FacetAcceptanceInitialWorkspace.Event) {
            do {
                guard evidence != nil else { throw FacetAcceptanceError.wrongApplication }
                try initialWorkspace.receive(
                    event, hasWindows: { !windows.isEmpty },
                    requestWindow: { delegate?.applicationOpenUntitledFile?(self) == true })
            } catch {
                preconditionFailure("Acceptance initial workspace could not be presented.")
            }
        }

        override func restoreWindow(
            withIdentifier identifier: NSUserInterfaceItemIdentifier, state: NSCoder,
            completionHandler: @escaping (NSWindow?, (any Error)?) -> Void
        ) -> Bool {
            do {
                guard let evidence else { throw FacetAcceptanceError.wrongApplication }
                // Do not decode the archived identifier or coder, or dispatch to its restoration class.
                return try evidence.declineRestoration { completionHandler(nil, nil) }
            } catch {
                completionHandler(nil, error)
                preconditionFailure("Acceptance restoration evidence could not be retained.")
            }
        }
    }
#endif
