import SwiftUI
import TaskNotesKit

/// A root owns the sheet; each entry point supplies an immutable vault and
/// canonical context for Rust's capture projection.
@MainActor internal final class FacetCaptureRequest {
    private let action: (String, [String: FacetValue]) -> Void

    init(_ action: @escaping (String, [String: FacetValue]) -> Void) {
        self.action = action
    }

    func present(profileID: String, properties: [String: FacetValue]) {
        action(profileID, properties)
    }
}

private struct FacetCaptureRequestKey: EnvironmentKey {
    static let defaultValue: FacetCaptureRequest? = nil
}

extension EnvironmentValues {
    internal var facetCaptureRequest: FacetCaptureRequest? {
        get { self[FacetCaptureRequestKey.self] }
        set { self[FacetCaptureRequestKey.self] = newValue }
    }
}

internal struct FacetCaptureSeed {
    let profileID: String
    let context: [String: FacetValue]
}
