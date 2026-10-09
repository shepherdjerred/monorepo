import Foundation
public import Observation
public import TaskNotesKit

/// A capture window owns its text and one exact submitted journal identity.
@Observable @MainActor public final class FacetCaptureDraft {
    public var input = "" {
        didSet { if input != oldValue { generation += 1 } }
    }
    public private(set) var isSubmitting = false
    public private(set) var error: String?
    public private(set) var admittedMutationID: String?
    @ObservationIgnored private var submission: FacetCaptureIntent?
    @ObservationIgnored private var executing = false
    private var generation = 0
    private var submittedGeneration = 0
    @ObservationIgnored private let lifecycleRegistration = UUID()

    public init() {}

    /// The reusable native panel keeps its buffer when hidden; its lifecycle veto
    /// must remain registered while that hidden buffer still belongs to a vault.
    public func registerLifecycle(
        store: FacetStore, profileID: String, coordinator: FacetDraftCoordinator = .shared
    ) {
        coordinator.register(
            lifecycleRegistration, owner: store, profileID: profileID,
            isDirty: { [weak self] in
                guard let self else { return false }
                return !self.input.isEmpty || self.hasRetainedSubmission || self.isSubmitting
            },
            flush: { [weak self] in
                guard let self else { return true }
                guard self.input.isEmpty, !self.hasRetainedSubmission, !self.isSubmitting else {
                    self.error =
                        "Add or discard this capture before switching vaults or closing the app."
                    return false
                }
                return true
            })
    }
    public var hasRetainedSubmission: Bool { submission != nil }
    public var canSubmit: Bool {
        !isSubmitting && submission == nil
            && !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Reserve synchronously before creating a Task; queued work cannot duplicate this capture.
    public func begin(
        store: FacetStore, profileID: String,
        properties: [String: FacetValue] = [:], body: String? = nil
    ) -> Bool {
        guard canSubmit else { return false }
        guard
            let intent = store.prepareNativeCapture(
                input, profileID: profileID, properties: properties, body: body)
        else {
            error = "Open the capture's owning vault before adding a task."
            return false
        }
        submission = intent
        submittedGeneration = generation
        isSubmitting = true
        error = nil
        return true
    }

    /// Applied receipts clear only the submitted text; newer typing remains available.
    @discardableResult public func submit(store: FacetStore) async -> Bool {
        guard isSubmitting, !executing, let submission else { return false }
        executing = true
        defer {
            isSubmitting = false
            executing = false
        }
        let admission = FacetMutationAdmission()
        let applied = await store.submitNativeCapture(submission, admission: admission)
        if applied {
            self.submission = nil
            admittedMutationID = nil
            if generation == submittedGeneration { input = "" }
            error = nil
            return true
        }
        admittedMutationID = admission.mutationID
        if admittedMutationID == nil {
            self.submission = nil
            error = store.error ?? "The capture could not be submitted. Its text is retained."
        } else {
            error =
                """
                This capture was submitted but its result is uncertain.
                Resume or retire its exact action in Settings recovery before adding another task.
                Newer text is retained.
                """
            await store.refreshNativeCaptureRecovery(submission)
        }
        return false
    }

    /// Clearing a submitted buffer requires a fresh reading of its exact retained action.
    @discardableResult public func discard(store: FacetStore) async -> Bool {
        guard !isSubmitting else { return false }
        let discardedGeneration = generation
        if let submission, let admittedMutationID {
            guard await store.nativeCaptureIsResolved(submission, mutationID: admittedMutationID)
            else {
                error =
                    "Resume or retire this capture's exact action in Settings recovery before discarding its buffer."
                return false
            }
        }
        submission = nil
        admittedMutationID = nil
        if generation == discardedGeneration { input = "" }
        error = nil
        return true
    }
}
