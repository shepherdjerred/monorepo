public import Foundation
public import TaskNotesKit

extension FacetStore {
    public func execute(
        _ command: [String: FacetValue], mutationID: String = UUID().uuidString,
        profileID owningProfile: String? = nil, admission: FacetMutationAdmission? = nil
    ) async -> Bool {
        guard let engine, let profileID = owningProfile ?? selectedProfileID else { return false }
        let intent =
            FacetFeedbackContext.intent ?? feedbackIntent(origin: FacetFeedbackContext.origin)
        return await actionCoordinator.submit {
            await self.executeDirect(
                command, mutationID: mutationID, profileID: profileID, engine: engine,
                admission: admission, origin: intent.origin, activationID: intent.activationID)
        }
    }

    internal func executeDirect(
        _ command: [String: FacetValue], mutationID: String, profileID: String,
        engine: FacetEngine, admission: FacetMutationAdmission? = nil,
        origin explicitOrigin: FacetFeedbackOrigin? = nil, activationID: UUID? = nil
    ) async -> Bool {
        guard self.engine === engine, selectedProfileID == profileID,
            !removingProfileIDs.contains(profileID)
        else {
            error =
                "This action still belongs to its original vault. Return to that vault to retry."
            return false
        }
        let origin = explicitOrigin ?? FacetFeedbackContext.origin ?? feedbackOrigin
        let session = feedbackSessionID
        let ownsIntent = presentationOwner(
            profileID: profileID, tracksRequest: false,
            ownsEngine: { self.engine === engine })
        let wasApplied: Bool
        do {
            let previous = try await engine.features(
                profileID: profileID,
                request: .object([
                    "kind": .string("mutation_receipt"), "mutationId": .string(mutationID),
                ]))
            wasApplied = previous.object?.fields["state"] == .string("applied")
        } catch {
            reportNativeFailure(error)
            return false
        }
        guard ownsIntent() else { return false }
        feedback.prepare()
        let applied = await runSavedAction(
            action: (mutationID: mutationID, profileID: profileID),
            ownsEngine: { self.engine === engine },
            apply: {
                try await engine.execute(
                    profileID: profileID, command: .object(command), mutationID: mutationID,
                    admission: admission)
            }, cleanup: { try await engine.discardObservedMutation(id: mutationID) },
            reload: { await self.reloadQuery(preservingSavedNotice: true) },
            verified: { receipt, ownsAction in
                let event = FacetFeedbackEvent(
                    sessionID: session, profileID: profileID,
                    receipt: receipt, command: command, origin: origin, activationID: activationID)
                if self.feedback.applied(event, ownsPresentation: ownsAction && !wasApplied) {
                    self.appliedFeedback = FacetAppliedFeedback(event: event)
                }
            })
        if !applied, admission?.mutationID != nil {
            await refreshSavedActions(
                ownsPresentation: { self.engine === engine },
                load: { try await engine.pendingMutations() })
        }
        return applied
    }

    public func createTask() async {
        guard !isSaving, !captureTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return }
        guard let engine, let profileID = captureProfileID ?? selectedProfileID else { return }
        let ownsPresentation = presentationOwner(
            profileID: profileID, tracksRequest: false, ownsEngine: { self.engine === engine })
        let draftID = captureMutationID
        isSaving = true
        defer { isSaving = false }
        if captureCommand == nil {
            await previewCapture()
            guard ownsPresentation(), draftID == captureMutationID else { return }
            guard let preview = capturePreview?.object?.fields,
                let properties = preview["properties"]
            else { return }
            captureCommand = .object([
                "kind": .string("create"), "properties": properties,
                "body": preview["body"] ?? .string(""),
            ])
        }
        guard case .object(let captureCommand) = captureCommand else { return }
        if await execute(captureCommand, mutationID: draftID, profileID: profileID),
            ownsPresentation(), draftID == captureMutationID
        {
            captureTitle = ""
            showsCapture = false
            captureMutationID = UUID().uuidString
            self.captureCommand = nil
            capturePreview = nil
            captureProfileID = nil
        }
    }

    public func previewCapture() async {
        guard let engine, let profileID = captureProfileID ?? selectedProfileID,
            !captureTitle.isEmpty
        else {
            capturePreview = nil
            return
        }
        previewGeneration += 1
        let request = previewGeneration
        let ownsPresentation = presentationOwner(
            profileID: profileID, ownsEngine: { self.engine === engine })
        do {
            let result = try await engine.features(
                profileID: profileID,
                request: .object([
                    "kind": .string("capture_preview"), "input": .string(captureTitle),
                    "at": .string(Date.now.ISO8601Format()),
                    "today": .string(clock.viewerCalendar().today),
                ]))
            if request == previewGeneration, ownsPresentation(),
                profileID == (captureProfileID ?? selectedProfileID)
            {
                capturePreview = result
            }
        } catch {
            if request == previewGeneration, ownsPresentation() {
                self.error = error.localizedDescription
            }
        }
    }

    public func readFeature(_ request: [String: FacetValue], profileID owningProfile: String? = nil)
        async -> FacetValue?
    {
        guard let engine, let profileID = owningProfile ?? selectedProfileID else { return nil }
        let ownsPresentation = presentationOwner(
            profileID: profileID, ownsEngine: { self.engine === engine })
        guard ownsPresentation() else { return nil }
        do {
            let value = try await engine.features(profileID: profileID, request: .object(request))
            return ownsPresentation() ? value : nil
        } catch {
            if ownsPresentation() { self.error = error.localizedDescription }
            return nil
        }
    }

    public func undoLast(profileID: String) async {
        guard let engine else { return }
        await undoWithOperations(
            profileID: profileID,
            operations: FacetUndoOperations(
                pending: { try await engine.pendingMutation(profileID: profileID, kind: "undo") },
                available: {
                    try await engine.features(
                        profileID: profileID, request: .object(["kind": .string("undo_available")]))
                },
                resume: { await self.resumeSavedAction($0) },
                perform: { _ = await self.perform($0, profileID: profileID) },
                ownsEngine: { self.engine === engine }))
    }

    public func batch(_ commands: [[String: FacetValue]]) async -> Bool {
        await execute([
            "kind": .string("batch"), "commands": .array(commands.map(FacetValue.object)),
        ])
    }

    @discardableResult public func toggle(_ task: FacetTask, profileID: String) async -> Bool {
        guard let engine else { return false }
        let current = presentationOwner(
            profileID: profileID, ownsEngine: { self.engine === engine })
        guard current() else { return false }
        clearSavedNotice()
        if task.isRecurring, task.occurrenceDate == nil {
            error =
                "Open Agenda or another dated view to choose the recurring occurrence to complete."
            return false
        }
        var command: [String: FacetValue] = [
            "kind": .string("set_completion"), "completed": .bool(!task.completed),
            "path": .string(task.path),
            "expectedRevision": .string(task.revision),
        ]
        if let day = task.occurrenceDate { command["occurrenceDate"] = .string(day) }
        return await perform(command, profileID: profileID)
    }

    public func setStatus(_ task: FacetTask, status: String, profileID: String) async {
        var command: [String: FacetValue] = [
            "kind": .string("set_status"), "path": .string(task.path),
            "expectedRevision": .string(task.revision), "status": .string(status),
        ]
        if let day = task.occurrenceDate { command["occurrenceDate"] = .string(day) }
        _ = await perform(command, profileID: profileID)
    }

    public func perform(_ command: [String: FacetValue], profileID: String) async -> Bool {
        guard let engine else { return false }
        let intent =
            FacetFeedbackContext.intent ?? feedbackIntent(origin: FacetFeedbackContext.origin)
        return await actionCoordinator.submit {
            do {
                guard self.engine === engine, self.selectedProfileID == profileID else {
                    self.error = "Return to the action's original vault to retry it."
                    return false
                }
                let existing = try await engine.savedMutationID(
                    profileID: profileID, command: .object(command))
                return await self.executeDirect(
                    command, mutationID: existing ?? UUID().uuidString,
                    profileID: profileID, engine: engine, origin: intent.origin,
                    activationID: intent.activationID)
            } catch {
                self.reportNativeFailure(error)
                return false
            }
        }
    }
    public func retireSavedAction(_ action: FacetPendingMutation) async {
        guard let engine, !isSaving,
            selectedProfileID == action.profileID
        else { return }
        let ownsPresentation = presentationOwner(
            profileID: action.profileID, ownsEngine: { self.engine === engine })
        isSaving = true
        defer { isSaving = false }
        do {
            try await engine.retireSavedMutation(id: action.id, expectedProfileID: action.profileID)
            await refreshSavedActions(
                ownsPresentation: ownsPresentation, load: { try await engine.pendingMutations() })
        } catch {
            if ownsPresentation() { self.error = error.localizedDescription }
        }
    }
}
