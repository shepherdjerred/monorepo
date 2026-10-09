import Foundation
import SwiftUI

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

/// Synthetic presentation inputs only. No engine, files, account or transport is opened.
enum FacetNativeGalleryState: String, CaseIterable, Sendable {
    case setup
    case setupLoading = "setup-loading"
    case signIn = "account-sign-in"
    case verification = "account-verification"
    case vaultSelection = "vault-selection"
    case inbox, today, upcoming, browse, empty, search, board
    case savedViews = "saved-views"
    case detail = "task-detail"
    case recurrence = "dates-recurrence"
    case relationships = "relationships-reminders"
    case inlineCompose = "inline-compose"
    case capture
    case preferences
    case connected = "sync-connected"
    case offline = "sync-offline"
    case conflicts
    case resolution = "conflict-resolution"
    case failedAction = "failed-action"

    var desktopSize: CGSize {
        switch self {
        case .detail: CGSize(width: 440, height: 1000)
        case .relationships: CGSize(width: 440, height: 1800)
        case .recurrence: CGSize(width: 700, height: 760)
        case .capture, .preferences, .failedAction: CGSize(width: 780, height: 900)
        case .setup, .setupLoading, .signIn, .verification, .vaultSelection,
            .inbox, .today, .upcoming, .browse, .empty, .search, .board, .savedViews,
            .inlineCompose, .connected, .offline, .conflicts, .resolution:
            CGSize(width: 1200, height: 760)
        }
    }

    /// Declared tall component viewport exposes controls below the first phone
    /// screen without claiming a tested scroll gesture or a physical device size.
    var mobileSize: CGSize {
        self == .relationships ? CGSize(width: 390, height: 1800) : CGSize(width: 390, height: 844)
    }

    var surface: FacetGallerySurface {
        switch self {
        case .setup: .onboarding
        case .setupLoading: .onboardingLoading
        case .signIn: .signIn
        case .verification: .verification
        case .vaultSelection: .remoteVaults
        case .empty: .empty
        case .search: .search
        case .savedViews: .savedViews
        case .detail, .recurrence: .editor
        case .relationships: .relationships
        case .conflicts: .conflicts
        case .resolution: .editResolution
        case .failedAction: .retired
        case .capture, .inlineCompose: .capture
        case .preferences: .preferences
        case .connected: .connected
        case .offline: .paused
        case .inbox, .today, .upcoming, .browse, .board: .populated
        }
    }
}

enum FacetNativeGalleryVariant: String, CaseIterable, Sendable {
    case narrow = "narrow-list"
    case wide = "wide-list"
    case largeList = "large-type-list"
    case largeDetail = "large-type-detail"
    case largeSetup = "large-type-setup"
    case reducedMotion = "reduced-motion-feedback"
    case highContrast = "high-contrast"
    case longLabels = "long-localized-labels"

    var state: FacetNativeGalleryState {
        switch self {
        case .largeDetail: .detail
        case .largeSetup: .setup
        case .narrow, .wide, .largeList, .reducedMotion, .highContrast, .longLabels: .inbox
        }
    }
    var dynamicType: DynamicTypeSize {
        switch self {
        case .largeList, .largeDetail, .largeSetup: .accessibility3
        case .narrow, .wide, .reducedMotion, .highContrast, .longLabels: .large
        }
    }

    /// A static frame proves composition under this preference, not animated feedback.
    var coversReference: Bool { self != .reducedMotion }

    var desktopSize: CGSize {
        switch self {
        case .narrow: CGSize(width: 800, height: 760)
        case .wide: CGSize(width: 1440, height: 900)
        case .largeDetail: CGSize(width: 500, height: 1200)
        case .largeList, .largeSetup, .reducedMotion, .highContrast, .longLabels:
            CGSize(width: 1200, height: 900)
        }
    }

    var mobileSize: CGSize {
        switch self {
        case .narrow: CGSize(width: 320, height: 844)
        case .wide: CGSize(width: 768, height: 1024)
        case .largeDetail, .largeSetup, .largeList: CGSize(width: 430, height: 1000)
        case .reducedMotion, .highContrast, .longLabels: CGSize(width: 390, height: 844)
        }
    }
}

@MainActor
struct FacetNativeGalleryFixture {
    let state: FacetNativeGalleryState
    let store: FacetStore
    let window: FacetWindowState
    let conflict: FacetConflict
    let timeZone: TimeZone

    init(_ state: FacetNativeGalleryState, longLabels: Bool = false) throws {
        self.state = state
        conflict = try FacetSurfaceFixtures.conflict()
        let base = try FacetSurfaceFixtures.store(state.surface)
        guard let instant = ISO8601DateFormatter().date(from: "2026-10-09T12:00:00Z"),
            let zone = TimeZone(secondsFromGMT: 0)
        else { throw FacetContractError.unsupportedResponse }
        timeZone = zone
        store = FacetStore(clock: SystemClock(timeZone: zone, instant: { instant }))
        store.profiles = base.profiles
        store.selectedProfileID = base.selectedProfileID
        store.snapshot = try Self.snapshot(base.snapshot, state: state, longLabels: longLabels)
        store.isLoading = base.isLoading
        store.accountNeedsCode = base.accountNeedsCode
        store.remoteVaults = base.remoteVaults
        store.conflicts = base.conflicts
        store.pendingActions = base.pendingActions
        store.syncStates = base.syncStates
        store.captureTitle = state == .inlineCompose ? base.captureTitle : ""
        if state == .offline {
            store.syncStates[FacetSurfaceFixtures.profileID] =
                "Offline. Local tasks remain available. Retry Sync when your connection returns."
        }
        window = FacetWindowState(store: store)
        window.scope = state == .today ? "today" : state == .upcoming ? "upcoming" : "inbox"
        if state == .browse { window.scope = "browse" }
        window.board = state == .board
        window.search = state == .search ? "release" : ""
        window.vocabulary = FacetWindowState.vocabulary(store.snapshot?.tasks ?? [])
        window.displayedQuery = try window.query()
        if state == .failedAction {
            store.pendingActions = [Self.failedAction()]
            store.error =
                "This original saved request is retained. Review its outcome before retiring it."
        }
    }

    private static func failedAction() -> FacetPendingMutation {
        let id = "00000000-0000-4000-8000-000000000002"
        return FacetPendingMutation(
            profileID: FacetSurfaceFixtures.profileID, id: id,
            mutation: .object([
                "mutationId": .string(id), "at": .string("2026-10-09T12:00:00Z"),
                "command": .object([
                    "kind": .string("update"), "path": .string("Tasks/Plan release.md"),
                    "expectedRevision": .string(String(repeating: "a", count: 64)),
                    "properties": .object(["title": .string("")]),
                ]),
            ]))
    }

    private static func snapshot(
        _ original: FacetSnapshot?, state: FacetNativeGalleryState, longLabels: Bool
    ) throws -> FacetSnapshot? {
        guard let original else { return nil }
        let encoded = try JSONEncoder().encode(original)
        guard case .object(var fields) = try JSONDecoder().decode(FacetValue.self, from: encoded)
        else { throw FacetContractError.unsupportedResponse }
        fields["configuration"] = configuration(longLabels: longLabels)
        if case .array(let tasks) = fields["tasks"] {
            fields["tasks"] = .array(
                try tasks.enumerated().map { index, task in
                    guard case .object(var value) = task else {
                        throw FacetContractError.unsupportedResponse
                    }
                    value["effectiveDate"] = .string(index == 0 ? "2026-10-09" : "2026-10-12")
                    // Codable omits nil optionals, while the native JSON contract
                    // requires this nullable field on every task row.
                    value["occurrenceDate"] = .null
                    if index == 0 {
                        value["occurrenceDate"] = .string("2026-10-09")
                        if longLabels {
                            value["title"] = .string(
                                "Eine längere Aufgabe, deren vollständiger Titel bei vergrößertem Text "
                                    + "gut lesbar bleibt")
                        }
                    }
                    return .object(value)
                })
            if state == .upcoming {
                var grouped: [String: [FacetValue]] = [:]
                for (index, task) in tasks.enumerated() {
                    guard let id = task.object?.fields["id"] else {
                        throw FacetContractError.unsupportedResponse
                    }
                    grouped[index == 0 ? "2026-10-09" : "2026-10-12", default: []].append(id)
                }
                fields["groups"] = .array(
                    grouped.sorted { $0.key < $1.key }.map { group in
                        .object(["key": .string(group.key), "taskIds": .array(group.value)])
                    })
            }
        }
        let value = FacetValue.object(fields)
        try FacetSchema.bundled().validate(value, definition: "snapshot")
        return try FacetFeatureProjection.decode(FacetSnapshot.self, from: value)
    }

    private static func configuration(longLabels: Bool) -> FacetValue {
        .object([
            "statuses": .array([
                statusChoice(
                    "open", longLabels ? "Offen und bereit für die nächste Aufgabe" : "Open",
                    "#5865F2", 0, completed: false),
                statusChoice("doing", "In progress", "#D97706", 1, completed: false),
                statusChoice("done", "Done", "#16A34A", 2, completed: true),
            ]),
            "priorities": .array([
                choice(
                    "normal",
                    longLabels ? "Normale Priorität mit ausführlicher Bezeichnung" : "Normal",
                    "#F59E0B", 1),
                choice("high", "High", "#EF4444", 9),
            ]),
        ])
    }

    private static func choice(
        _ value: String, _ label: String, _ color: String, _ weight: Int64
    ) -> FacetValue {
        let fields: [String: FacetValue] = [
            "value": .string(value), "label": .string(label),
            "color": .string(color), "weight": .integer(weight), "order": .integer(weight),
        ]
        return .object(fields)
    }

    private static func statusChoice(
        _ value: String, _ label: String, _ color: String, _ weight: Int64, completed: Bool
    ) -> FacetValue {
        .object([
            "value": .string(value), "label": .string(label), "color": .string(color),
            "weight": .integer(weight), "order": .integer(weight), "isCompleted": .bool(completed),
        ])
    }
}

/// Actual app views, synthetic inputs and declared traits. This is presentation
/// evidence, not account, Sync or mutation acceptance.
@MainActor
struct FacetNativeGalleryFrame: View {
    let fixture: FacetNativeGalleryFixture
    var variant: FacetNativeGalleryVariant?

    var body: some View {
        FacetNativeGalleryScene(fixture: fixture)
            .environment(\.locale, Locale(identifier: "en_US"))
            .environment(\.timeZone, fixture.timeZone)
            .environment(\.dynamicTypeSize, variant?.dynamicType ?? .large)
    }
}

@MainActor
struct FacetNativeGalleryScene: View {
    let fixture: FacetNativeGalleryFixture

    @ViewBuilder var body: some View {
        switch fixture.state {
        case .setup, .setupLoading:
            FacetVaultOnboarding(
                store: fixture.store, importsFolder: .constant(false),
                folderAction: "Import vault copy…")
        case .signIn, .verification, .vaultSelection:
            FacetAccountForm(store: fixture.store)
        case .inbox, .today, .upcoming, .empty, .search, .board, .browse, .connected, .offline:
            FacetNativeWorkspace(
                store: fixture.store, importsFolder: .constant(false), window: fixture.window)
        case .savedViews:
            FacetSavedViewsForm(
                store: fixture.store, profileID: FacetSurfaceFixtures.profileID,
                board: .constant(false), window: fixture.window)
        case .recurrence:
            FacetRecurrenceEditorSheet(
                existingRule: "FREQ=WEEKLY;BYDAY=MO,FR",
                editableDraft: FacetCommonRecurrenceDraft(
                    interval: 1, pattern: .weekly(weekdays: [.monday, .friday]), ending: .never),
                storedScheduled: "2026-10-09", start: "2026-10-09", anchor: .scheduled,
                onApply: { _ in })
        case .relationships:
            if let task = fixture.store.snapshot?.tasks.first {
                FacetTaskEditor(
                    store: fixture.store, task: task, profileID: FacetSurfaceFixtures.profileID,
                    statuses: fixture.store.statuses, priorities: fixture.store.priorities)
            }
        case .detail:
            if let task = fixture.store.snapshot?.tasks.first {
                #if os(macOS)
                    FacetNativeInspector(
                        store: fixture.store, window: fixture.window,
                        draft: FacetInspectorDraft(
                            task: task, profileID: FacetSurfaceFixtures.profileID),
                        configuration: fixture.store.snapshot?.configuration ?? .null)
                #else
                    FacetTaskEditor(
                        store: fixture.store, task: task, profileID: FacetSurfaceFixtures.profileID,
                        statuses: fixture.store.statuses, priorities: fixture.store.priorities)
                #endif
            }
        case .capture:
            FacetCaptureForm(store: fixture.store)
        case .inlineCompose:
            #if os(macOS)
                if let snapshot = fixture.window.snapshot {
                    FacetNativeTaskList(
                        store: fixture.store, window: fixture.window,
                        snapshot: snapshot, selected: nil, open: { _ in })
                }
            #else
                FacetCaptureForm(store: fixture.store)
            #endif
        case .preferences, .failedAction:
            NavigationStack {
                FacetNativeSettings(store: fixture.store, importsFolder: .constant(false))
            }
        case .conflicts:
            FacetConflictInbox(store: fixture.store)
        case .resolution:
            FacetConflictForm(
                store: fixture.store, profileID: FacetSurfaceFixtures.profileID,
                conflict: fixture.conflict,
                initialText:
                    "# Release checklist\n\nKeep both original versions until this edit is saved.",
                saved: {})
        }
    }
}
