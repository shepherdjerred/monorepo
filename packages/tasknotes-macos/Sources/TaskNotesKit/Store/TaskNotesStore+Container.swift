internal import Synchronization
public import TaskNotesUniFFI

// The two ways a store is assembled and described, split out of
// `TaskNotesStore.swift` so neither file grows past the length the linter
// enforces. Nothing here has behaviour: it is construction and one diagnostic
// string.

extension TaskNotesStore {
    /// Assemble a store over the sandbox container.
    ///
    /// Returns the failure instead of throwing, because the only caller is a
    /// SwiftUI `@State` initialiser, which cannot `try`. Trapping instead would
    /// turn "Application Support is unwritable" into a launch crash with no
    /// explanation; a `Result` lets the shell say what went wrong.
    public static func containerDefault(
        clock: any CoreClock & ViewerCalendarSource = SystemClock(),
        randomness: any Randomness = SystemRandomness()
    ) -> Result<TaskNotesStore, CoreError> {
        do {
            let storage = try FileHostStorage.containerDefault()
            return .success(TaskNotesStore(storage: storage, clock: clock, randomness: randomness))
        } catch {
            return .failure(error)
        }
    }
}
