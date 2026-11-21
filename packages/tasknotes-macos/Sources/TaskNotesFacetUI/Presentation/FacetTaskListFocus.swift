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
    #if os(macOS)
        @Entry internal var facetKeyboardTaskIDs: [String] = []
    #endif
    @Entry internal var facetTaskListFocus: FacetTaskListFocus?
}

internal struct FacetTaskFocus: ViewModifier {
    @Environment(\.facetTaskListFocus) private var focus
    #if os(macOS)
        @Environment(\.facetKeyboardTaskIDs) private var taskIDs
    #endif
    let target: FacetTaskFocusTarget

    func body(content: Content) -> some View {
        if let focus {
            content
                #if os(macOS)
                    .focusable()
                    .onKeyPress(keys: [.upArrow, .downArrow]) { press in
                        let shortcuts: EventModifiers = [.command, .control, .option, .shift]
                        guard press.modifiers.isDisjoint(with: shortcuts), !taskIDs.isEmpty
                        else {
                            return .ignored
                        }
                        let index: Int
                        switch target {
                        case .heading: index = -1
                        case .title(let id), .completion(let id):
                            index = taskIDs.firstIndex(of: id) ?? -1
                        }
                        let next = max(
                            0, min(taskIDs.count - 1, index + (press.key == .downArrow ? 1 : -1)))
                        focus.keyboard.wrappedValue = .title(taskIDs[next])
                        return .handled
                    }
                #endif
                .focused(focus.keyboard, equals: target)
                .accessibilityFocused(focus.accessibility, equals: target)
        } else {
            content
        }
    }
}
