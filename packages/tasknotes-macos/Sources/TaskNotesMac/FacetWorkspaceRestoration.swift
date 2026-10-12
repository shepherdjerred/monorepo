import Foundation
public import SwiftUI
import TaskNotesKit

extension Scene {
    /// Synthetic acceptance runs must not inherit windows from earlier runs.
    /// Production keeps SwiftUI's normal window restoration.
    public func facetWorkspaceRestoration() -> some Scene {
        #if DEBUG
            let policy: FacetWorkspaceRestorationPolicy
            do {
                policy = try .resolve(bundleID: Bundle.main.bundleIdentifier) {
                    try FacetAcceptanceConfiguration.launch()
                }
            } catch {
                preconditionFailure(
                    "Acceptance window isolation requires a valid launch descriptor.")
            }
            return restorationBehavior(policy == .isolatedAcceptance ? .disabled : .automatic)
        #else
            return restorationBehavior(.automatic)
        #endif
    }
}

#if DEBUG
    internal enum FacetWorkspaceRestorationPolicy: Equatable {
        case production, isolatedAcceptance

        static func resolve(
            bundleID: String?,
            acceptance: () throws -> FacetAcceptanceConfiguration?
        ) throws -> Self {
            try configuration(bundleID: bundleID, acceptance: acceptance) == nil
                ? .production : .isolatedAcceptance
        }

        static func configuration(
            bundleID: String?, acceptance: () throws -> FacetAcceptanceConfiguration?
        ) throws -> FacetAcceptanceConfiguration? {
            guard bundleID == "red.sjer.tasknotes.mac.acceptance" else { return nil }
            guard let configuration = try acceptance() else {
                throw FacetAcceptanceError.invalidDescriptor
            }
            return configuration
        }
    }
#endif
