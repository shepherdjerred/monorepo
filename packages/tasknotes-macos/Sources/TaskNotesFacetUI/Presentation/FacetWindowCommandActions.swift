public import SwiftUI

/// The menu bar addresses the focused standalone window, never a legacy store.
@MainActor public struct FacetWindowCommandActions {
    public let hasSelection: Bool
    public let inspectorPresented: Bool
    public let newTask: @MainActor () -> Void
    public let find: @MainActor () -> Void
    public let navigate: @MainActor (String) -> Void
    public let complete: @MainActor () -> Void
    public let delete: @MainActor () -> Void
    public let toggleInspector: @MainActor () -> Void
    public let refresh: @MainActor () -> Void
}

private struct FacetWindowCommandKey: FocusedValueKey {
    typealias Value = FacetWindowCommandActions
}
extension FocusedValues {
    public var facetWindowCommands: FacetWindowCommandActions? {
        get { self[FacetWindowCommandKey.self] }
        set { self[FacetWindowCommandKey.self] = newValue }
    }
}
