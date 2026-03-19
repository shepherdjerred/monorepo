import SwiftUI

// MARK: - SelectedServiceKey

private struct SelectedServiceKey: FocusedValueKey {
    typealias Value = ServiceSnapshot
}

extension FocusedValues {
    var selectedService: ServiceSnapshot? {
        get { self[SelectedServiceKey.self] }
        set { self[SelectedServiceKey.self] = newValue }
    }
}
