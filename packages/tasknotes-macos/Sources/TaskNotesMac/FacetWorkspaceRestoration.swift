import Foundation
public import SwiftUI
import TaskNotesKit

extension Scene {
    /// Isolated test and smoke runs do not inherit windows from earlier sessions.
    public func facetWorkspaceRestoration() -> some Scene {
        let args = CommandLine.arguments
        let isolated =
            args.contains(UITesting.flagArgument) || args.contains("--facet-release-smoke")
        return restorationBehavior(isolated ? .disabled : .automatic)
    }
}
