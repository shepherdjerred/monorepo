import Foundation
import TaskNotesKit

/// The engine, vault, input, clock and overrides are frozen before presentation yields.
internal struct FacetCaptureIntent {
    let engine: FacetEngine
    let profileID: String
    let mutationID: String
    let request: FacetValue
    let properties: [String: FacetValue]
    let body: String?
}

extension FacetStore {
    internal func prepareNativeCapture(
        _ input: String, profileID: String, properties: [String: FacetValue], body: String?
    ) -> FacetCaptureIntent? {
        guard let engine, selectedProfileID == profileID,
            !removingProfileIDs.contains(profileID)
        else { return nil }
        let calendar = clock.viewerCalendar()
        return FacetCaptureIntent(
            engine: engine, profileID: profileID, mutationID: UUID().uuidString,
            request: .object([
                "kind": .string("capture_preview"), "input": .string(input),
                "at": .string(calendar.instant.ISO8601Format()), "today": .string(calendar.today),
            ]), properties: properties, body: body)
    }

    internal func submitNativeCapture(
        _ intent: FacetCaptureIntent, admission: FacetMutationAdmission
    )
        async -> Bool
    {
        await actionCoordinator.submit {
            do {
                guard self.engine === intent.engine, self.selectedProfileID == intent.profileID
                else {
                    self.error = "Return to the capture's original vault before adding it."
                    return false
                }
                let preview = try await intent.engine.features(
                    profileID: intent.profileID, request: intent.request)
                guard let fields = preview.object?.fields,
                    var properties = fields["properties"]?.object?.fields
                else { throw FacetContractError.unsupportedResponse }
                properties.merge(intent.properties) { _, replacement in replacement }
                return await self.executeDirect(
                    [
                        "kind": .string("create"), "properties": .object(properties),
                        "body": intent.body.map(FacetValue.string) ?? fields["body"] ?? .string(""),
                    ], mutationID: intent.mutationID, profileID: intent.profileID,
                    engine: intent.engine, admission: admission)
            } catch {
                self.reportNativeFailure(error)
                return false
            }
        }
    }

    internal func refreshNativeCaptureRecovery(_ intent: FacetCaptureIntent) async {
        guard engine === intent.engine else { return }
        do {
            var pending: [FacetPendingMutation] = []
            var cursor: String?
            while true {
                let page = try await intent.engine.pendingMutations(afterID: cursor)
                guard engine === intent.engine else { return }
                pending.append(contentsOf: page)
                guard page.count == 128, let last = page.last else { break }
                cursor = last.id
            }
            pendingActions = pending
        } catch {
            reportNativeFailure(error)
        }
    }

    internal func nativeCaptureIsResolved(_ intent: FacetCaptureIntent, mutationID: String) async
        -> Bool
    {
        guard engine === intent.engine else { return false }
        do {
            var cursor: String?
            while true {
                let page = try await intent.engine.pendingMutations(
                    profileID: intent.profileID, afterID: cursor)
                guard engine === intent.engine else { return false }
                if page.contains(where: { $0.id == mutationID }) { return false }
                guard page.count == 128, let last = page.last else { return true }
                cursor = last.id
            }
        } catch {
            reportNativeFailure(error)
            return false
        }
    }
}
