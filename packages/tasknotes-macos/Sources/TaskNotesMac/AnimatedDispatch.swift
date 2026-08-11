internal import SwiftUI
internal import TaskNotesKit
internal import TaskNotesUniFFI

extension TaskNotesStore {
    /// Record a mutation whose visible result should animate.
    ///
    /// ``TaskNotesStore/dispatch(_:publishing:)`` runs the enqueue on the
    /// engine's own queue — it must never take the engine's mutex from the main
    /// actor — and publishes the new snapshot when that comes back, which is
    /// *after* a suspension point. `withAnimation` is a synchronous scope, so
    /// wrapping the call site animates nothing at all; the scope has to travel
    /// with the publish, which is what the parameter exists for.
    ///
    /// One duration for every row change in the app, so a completion in a list
    /// and the same completion on the board move at the same speed.
    @discardableResult
    func dispatchAnimated(_ input: CommandInput) async -> CoreTask? {
        await dispatch(input) { withAnimation(.snappy(duration: 0.2), $0) }
    }
}
