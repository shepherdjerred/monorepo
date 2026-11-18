import AppKit
import Foundation
import TaskNotesKit

/// Runs before SwiftUI constructs its App or application-delegate adaptor.
@MainActor
public enum FacetMacApplicationBootstrap {
    public static func prepare() {
        // Disable macOS saved-state restoration for isolated UI tests and release smoke checks.
        let args = CommandLine.arguments
        if args.contains(UITesting.flagArgument) || args.contains("--facet-release-smoke") {
            UserDefaults.standard.set(false, forKey: "NSQuitAlwaysKeepsWindows")
        }
    }
}
