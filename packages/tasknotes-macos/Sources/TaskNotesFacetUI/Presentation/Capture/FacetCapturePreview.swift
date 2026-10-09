import Foundation
public import Observation
public import TaskNotesKit

/// A disposable read projection, never a submitted envelope or a second NLP parser.
@Observable @MainActor public final class FacetCapturePreview {
    public private(set) var properties: [String: FacetValue] = [:]
    public private(set) var body = ""
    public private(set) var isLoading = false
    public private(set) var error: String?
    private var generation: UInt64 = 0
    public private(set) var input: String?

    public init() {}
    public func canSubmit(_ text: String) -> Bool {
        input == text && !isLoading && error == nil
            && !(properties["title"]?.text?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ?? true)
    }
    public func needsTitle(_ text: String) -> Bool {
        input == text && !isLoading && error == nil && !canSubmit(text)
    }
    public func override(_ role: String, value: FacetValue) {
        generation += 1
        isLoading = false
        properties[role] = value
    }
    public func refresh(
        store: FacetStore, profileID: String?, input: String,
        overrides: [String: FacetValue]
    ) async {
        guard let engine = store.engine, let profileID, store.selectedProfileID == profileID else {
            generation += 1
            properties = [:]
            body = ""
            self.input = nil
            isLoading = false
            return
        }
        let calendar = store.clock.viewerCalendar()
        await load(
            input: input, overrides: overrides,
            ownsOwner: { store.engine === engine && store.selectedProfileID == profileID },
            read: {
                try await engine.features(
                    profileID: profileID,
                    request: .object([
                        "kind": .string("capture_preview"), "input": .string(input),
                        "at": .string(calendar.instant.ISO8601Format()),
                        "today": .string(calendar.today),
                    ]))
            })
    }

    internal func load(
        input: String, overrides: [String: FacetValue],
        delay: Duration = .milliseconds(160), ownsOwner: () -> Bool,
        read: () async throws -> FacetValue
    ) async {
        generation += 1
        let request = generation
        error = nil
        if input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            properties = overrides
            body = ""
            self.input = input
            isLoading = false
            return
        }
        isLoading = true
        defer { if request == generation { isLoading = false } }
        do {
            try await _Concurrency.Task.sleep(for: delay)
            guard ownsOwner(), request == generation, !_Concurrency.Task.isCancelled else { return }
            let value = try await read()
            guard ownsOwner(), request == generation, !_Concurrency.Task.isCancelled else { return }
            guard let parsed = value.object?.fields["properties"]?.object?.fields else {
                throw FacetContractError.unsupportedResponse
            }
            properties = parsed.merging(overrides) { _, explicit in explicit }
            guard let parsedBody = value.object?.fields["body"]?.text else {
                throw FacetContractError.unsupportedResponse
            }
            body = parsedBody
            self.input = input
        } catch is CancellationError {
            return
        } catch {
            if request == generation, ownsOwner() {
                properties = [:]
                self.error =
                    "Capture preview is unavailable: \(FacetFailureDiagnostic(error).action)"
            }
        }
    }
}
