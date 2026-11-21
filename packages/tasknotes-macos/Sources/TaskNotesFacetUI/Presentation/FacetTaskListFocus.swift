import SwiftUI

internal enum FacetTaskFocusTarget: Hashable {
    case heading
    case title(String)
    case completion(String)

    /// Continue down the list, or return to the preceding row when the last one goes away.
    func afterRemovingRows(from previous: [String], remaining: [String]) -> Self {
        switch self {
        case .heading:
            return self
        case .title(let id), .completion(let id):
            guard let index = previous.firstIndex(of: id), !remaining.contains(id) else {
                return self
            }
            let available = Set(remaining)
            let neighbor =
                previous[index...].first(where: available.contains)
                ?? previous[..<index].last(where: available.contains) ?? remaining.first
            guard let neighbor else { return .heading }
            return self == .title(id) ? .title(neighbor) : .completion(neighbor)
        }
    }
}

internal struct FacetTaskListFocus {
    let keyboard: FocusState<FacetTaskFocusTarget?>.Binding
    let accessibility: AccessibilityFocusState<FacetTaskFocusTarget?>.Binding

    func preserve(from previous: [String], remaining: [String]) {
        if let current = keyboard.wrappedValue {
            let next = current.afterRemovingRows(from: previous, remaining: remaining)
            if next != current { keyboard.wrappedValue = next }
        }
        if let current = accessibility.wrappedValue {
            let next = current.afterRemovingRows(from: previous, remaining: remaining)
            if next != current { accessibility.wrappedValue = next }
        }
    }
}

extension EnvironmentValues {
    @Entry internal var facetTaskListFocus: FacetTaskListFocus?
}

internal struct FacetTaskFocus: ViewModifier {
    @Environment(\.facetTaskListFocus) private var focus
    let target: FacetTaskFocusTarget

    func body(content: Content) -> some View {
        if let focus {
            content
                .focused(focus.keyboard, equals: target)
                .accessibilityFocused(focus.accessibility, equals: target)
        } else {
            content
        }
    }
}
