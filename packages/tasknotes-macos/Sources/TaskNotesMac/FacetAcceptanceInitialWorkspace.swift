#if DEBUG
    import TaskNotesKit

    /// Joins the two documented launch events without polling or replaying a request.
    @MainActor
    internal final class FacetAcceptanceInitialWorkspace {
        enum Event {
            case restorationFinished, launchFinished
        }

        private var restorationFinished = false
        private var launchFinished = false
        private var settled = false

        func receive(
            _ event: Event, hasWindows: () -> Bool, requestWindow: () -> Bool
        ) throws {
            switch event {
            case .restorationFinished: restorationFinished = true
            case .launchFinished: launchFinished = true
            }
            guard restorationFinished, launchFinished, !settled else { return }
            // Commit ownership before calling out, including reentrant/failed requests.
            settled = true
            guard !hasWindows() else { return }
            guard requestWindow() == true else { throw FacetAcceptanceError.wrongApplication }
        }
    }
#endif
