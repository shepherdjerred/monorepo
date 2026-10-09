import Foundation
import SwiftUI

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

/// Native component fixtures use an isolated local Rust engine for parser and
/// Undo authority. They are presentation inputs, not automated user journeys.
enum FacetDelightGalleryState: String, CaseIterable, Sendable {
    case captureEmpty = "capture-empty"
    case captureParsed = "capture-parsed-chips"
    case captureNeedsTitle = "capture-needs-title"
    case captureDetails = "capture-details"
    case captureCleared = "capture-explicit-clears"
    case settingsOn = "feedback-settings-on"
    case settingsOff = "feedback-settings-off"
    case settingsRecovery = "feedback-settings-recovery"
    case created, completed, deleted, reopened, undone, saved
    case recovery = "capture-saved-action-recovery"

    var isCapture: Bool {
        [.captureEmpty, .captureParsed, .captureNeedsTitle, .captureDetails, .captureCleared]
            .contains(self)
    }
    var size: CGSize {
        #if os(macOS)
            if isCapture {
                return CGSize(
                    width: 560,
                    height: self == .captureDetails || self == .captureCleared ? 1000 : 460)
            }
            return CGSize(width: 760, height: 680)
        #else
            CGSize(
                width: 390, height: self == .captureDetails || self == .captureCleared ? 1400 : 844)
        #endif
    }
}

@MainActor final class FacetDelightGalleryFixture {
    let state: FacetDelightGalleryState
    let store: FacetStore
    let draft = FacetCaptureDraft()
    let preview = FacetCapturePreview()
    let engine: FacetEngine
    let profileID: String
    let directory: URL
    let defaults: UserDefaults
    let suite: String
    let feedback: FacetNativeFeedback
    var properties: [String: FacetValue] = [:]
    var notes: String?
    var previewIsCurrent: Bool {
        preview.input == draft.input && !preview.isLoading && preview.error == nil
    }

    private init(
        state: FacetDelightGalleryState, store: FacetStore, engine: FacetEngine,
        profileID: String, directory: URL, defaults: UserDefaults, suite: String,
        feedback: FacetNativeFeedback
    ) {
        self.state = state
        self.store = store
        self.engine = engine
        self.profileID = profileID
        self.directory = directory
        self.defaults = defaults
        self.suite = suite
        self.feedback = feedback
    }

    static func open(_ state: FacetDelightGalleryState) async throws -> FacetDelightGalleryFixture {
        let renderDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(
            "facet-delight-render-\(UUID().uuidString)")
        let vault = renderDirectory.appendingPathComponent("vault")
        try FileManager.default.createDirectory(at: vault, withIntermediateDirectories: true)
        let renderEngine = try await FacetEngine.open(
            directory: renderDirectory.appendingPathComponent("engine"), secrets: ComponentKeys())
        let profile = try await renderEngine.registerLocal(directory: vault, approveStandard: true)
        _ = try await renderEngine.refresh(profileID: profile.id)
        guard let instant = ISO8601DateFormatter().date(from: "2026-10-09T12:00:00Z"),
            let zone = TimeZone(secondsFromGMT: 0)
        else {
            throw FacetContractError.unsupportedResponse
        }
        let renderStore = FacetStore(clock: SystemClock(timeZone: zone, instant: { instant }))
        renderStore.engine = renderEngine
        renderStore.selectedProfileID = profile.id
        renderStore.profiles = [profile]
        renderStore.snapshot = try await renderEngine.snapshot(
            profileID: profile.id, query: .object([:]))
        let renderSuite = "FacetDelightGallery-\(UUID().uuidString)"
        guard let renderDefaults = UserDefaults(suiteName: renderSuite) else {
            throw FacetContractError.unsupportedResponse
        }
        if state == .settingsOff {
            renderDefaults.set(
                try JSONEncoder().encode(FacetFeedbackPreference(sounds: false, haptics: false)),
                forKey: "Facet.feedback.preference")
        } else if state == .settingsRecovery {
            renderDefaults.set(Data("invalid".utf8), forKey: "Facet.feedback.preference")
        }
        let renderFeedback = FacetNativeFeedback(defaults: renderDefaults, sink: { _ in })
        renderStore.feedback = renderFeedback
        let fixture = FacetDelightGalleryFixture(
            state: state, store: renderStore, engine: renderEngine,
            profileID: profile.id, directory: renderDirectory, defaults: renderDefaults,
            suite: renderSuite,
            feedback: renderFeedback)
        try await fixture.prepare()
        return fixture
    }

    private func prepare() async throws {
        if state.isCapture {
            await prepareCapture()
            return
        }
        if [.settingsOn, .settingsOff, .settingsRecovery].contains(state) { return }
        if state == .recovery {
            let drafts = try FacetMutationDrafts(
                directory: directory.appendingPathComponent("engine/action-drafts"))
            _ = try drafts.envelope(
                profileID: profileID, id: UUID().uuidString,
                command: .object([
                    "kind": .string("create"), "properties": .object(["title": .string("")]),
                ]),
                at: "2026-10-09T12:00:00Z")
            store.pendingActions = try await engine.pendingMutations()
            return
        }
        try await prepareReceipt()
    }
    private func prepareCapture() async {
        if state != .captureEmpty {
            draft.input =
                state == .captureNeedsTitle
                ? "tomorrow p:Work" : "Pay rent tomorrow p:Home @desk #finance"
        }
        if state == .captureDetails {
            notes = "Keep the receipt with the monthly household notes."
            properties["scheduled"] = .string("2026-10-09")
        }
        if state == .captureCleared {
            notes = ""
            properties = [
                "due": .null, "projects": .array([]), "contexts": .array([]),
                "tags": .array([]),
            ]
        }
        await preview.refresh(
            store: store, profileID: profileID, input: draft.input, overrides: properties)
    }
    private func prepareReceipt() async throws {
        var command: [String: FacetValue] = [
            "kind": .string("create"),
            "properties": .object([
                "title": .string("Ship the refreshed capture"), "due": .string("2026-10-09"),
            ]),
        ]
        var receipt = try await engine.execute(profileID: profileID, command: .object(command))
        if state != .created {
            if state == .reopened {
                let task = try await task()
                _ = try await engine.execute(
                    profileID: profileID, command: .object(completion(task, completed: true)))
            }
            let task = try await task()
            if state == .completed || state == .reopened {
                command = completion(task, completed: state == .completed)
            } else if state == .deleted || state == .undone {
                command = [
                    "kind": .string("delete_checked"), "path": .string(task.path),
                    "expectedRevision": .string(task.revision),
                    "checkBacklinks": .bool(true), "force": .bool(false),
                ]
            } else {
                command = [
                    "kind": .string("edit_task"), "path": .string(task.path),
                    "expectedRevision": .string(task.revision),
                    "properties": .object(["contexts": .array([.string("desk")])]),
                ]
            }
            receipt = try await engine.execute(profileID: profileID, command: .object(command))
            if state == .undone {
                command = ["kind": .string("undo"), "receiptId": .string(receipt.mutationId)]
                receipt = try await engine.execute(profileID: profileID, command: .object(command))
            }
        }
        guard receipt.applied else { throw FacetContractError.unsupportedResponse }
        store.snapshot = try await engine.snapshot(profileID: profileID, query: .object([:]))
        store.appliedFeedback = FacetAppliedFeedback(
            event: FacetFeedbackEvent(
                sessionID: store.feedbackSessionID, profileID: profileID, receipt: receipt,
                command: command, origin: nil))
    }
    private func task() async throws -> FacetTask {
        guard
            let task = try await engine.snapshot(profileID: profileID, query: .object([:])).tasks
                .first
        else {
            throw FacetContractError.unsupportedResponse
        }
        return task
    }
    private func completion(_ task: FacetTask, completed: Bool) -> [String: FacetValue] {
        [
            "kind": .string("set_completion"), "path": .string(task.path),
            "expectedRevision": .string(task.revision), "completed": .bool(completed),
            "occurrenceDate": .null,
        ]
    }
    func close() async throws {
        try await engine.close()
        defaults.removePersistentDomain(forName: suite)
        try FileManager.default.removeItem(at: directory)
    }
}

struct FacetDelightGalleryFrame: View {
    let fixture: FacetDelightGalleryFixture
    var body: some View {
        Group {
            if fixture.state.isCapture {
                FacetCaptureForm(
                    store: fixture.store, draft: fixture.draft, preview: fixture.preview,
                    detailsExpanded: fixture.state == .captureDetails
                        || fixture.state == .captureCleared,
                    notes: fixture.notes, properties: fixture.properties, retainedPanel: usesPanel)
            } else if [.settingsOn, .settingsOff, .settingsRecovery].contains(fixture.state) {
                Form { Section("Feedback") { FacetFeedbackSettings(feedback: fixture.feedback) } }
            } else if fixture.state == .recovery {
                FacetCaptureRecoveryView(store: fixture.store)
            } else if let snapshot = fixture.store.snapshot {
                FacetNativeTaskList(
                    store: fixture.store, window: FacetWindowState(store: fixture.store),
                    snapshot: snapshot, selected: nil, open: { _ in })
            }
        }.environment(\.timeZone, .gmt)
            .environment(\.locale, Locale(identifier: "en_US"))
    }
    private var usesPanel: Bool {
        #if os(macOS)
            true
        #else
            false
        #endif
    }
}
