import Foundation
import SwiftUI

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

enum FacetGalleryFamily {
    case workspace, account, editor, views, move, bulk, conflicts, resolution, capture, preferences
}

enum FacetGallerySurface: String, CaseIterable {
    case onboarding = "01-vault-setup"
    case onboardingLoading = "02-vault-setup-loading"
    case signIn = "03-account-sign-in"
    case verification = "04-account-verification"
    case remoteVaults = "05-sync-vault-selection"
    case populated = "06-workspace-task-statuses"
    case empty = "07-workspace-empty"
    case opening = "08-vault-opening"
    case consent = "09-standard-settings-consent"
    case connected = "10-sync-connected"
    case paused = "11-sync-paused"
    case reminders = "12-reminder-authorization"
    case retired = "13-retained-action-selected-vault"
    case retiredOtherVault = "14-retained-action-other-vault"
    case problems = "15-note-validation-problem"
    case board = "16-task-board"
    case search = "17-task-search-result"
    case savedViews = "18-saved-views"
    case emptyViews = "19-saved-views-empty"
    case editor = "20-task-dates-and-recurrence"
    case relationships = "21-task-reminders-and-dependencies"
    case missingCreation = "22-task-missing-creation-date"
    case move = "23-move-task-note"
    case bulk = "24-bulk-recurring-task-actions"
    case conflicts = "25-conflicting-retained-versions"
    case resolved = "26-conflicts-resolved"
    case editResolution = "27-edit-conflict-resolution"
    case keepBoth = "28-keep-both-conflict-versions"
    case failedResolution = "29-conflict-resolution-error"
    case capture = "30-add-task"
    case preferences = "31-preferences"

    var family: FacetGalleryFamily {
        switch self {
        case .onboarding, .onboardingLoading, .populated, .empty, .opening, .consent,
            .connected, .paused, .reminders, .retired, .retiredOtherVault, .problems, .board,
            .search:
            .workspace
        case .signIn, .verification, .remoteVaults: .account
        case .editor, .relationships, .missingCreation: .editor
        case .savedViews, .emptyViews: .views
        case .move: .move
        case .bulk: .bulk
        case .conflicts, .resolved: .conflicts
        case .editResolution, .keepBoth, .failedResolution: .resolution
        case .capture: .capture
        case .preferences: .preferences
        }
    }

    var size: CGSize {
        if family == .editor {
            return CGSize(width: 1000, height: self == .relationships ? 1500 : 1100)
        }
        if family == .workspace { return CGSize(width: 1000, height: 600) }
        if family == .capture { return CGSize(width: 740, height: 240) }
        if family == .preferences { return CGSize(width: 480, height: 320) }
        return CGSize(width: 900, height: 600)
    }

    var caption: String {
        rawValue.dropFirst(3).replacingOccurrences(of: "-", with: " ").capitalized
    }
}

@MainActor
enum FacetSurfaceFixtures {
    static let profileID = "fixture-vault"
    private static let revision = String(repeating: "a", count: 64)

    static func store(_ surface: FacetGallerySurface) throws -> FacetStore {
        let store = FacetStore()
        store.selectedProfileID = profileID
        store.profiles = [
            FacetProfile(
                id: profileID, name: "Personal vault", kind: "local", approveStandard: true),
            FacetProfile(
                id: "work-vault", name: "Work vault", kind: "remote", approveStandard: true),
        ]
        store.snapshot = try snapshot(surface)
        configureWorkspace(store, surface)
        if surface == .verification { store.accountNeedsCode = true }
        if surface == .remoteVaults { store.remoteVaults = try remoteVaults() }
        if surface == .conflicts { store.conflicts = try [conflict()] }
        if surface == .failedResolution {
            store.error = "The note changed. Both original versions remain retained."
        }
        if surface == .capture {
            store.captureTitle = "Plan team release !high due:2026-10-12 p:Work"
        }
        return store
    }

    private static func configureWorkspace(_ store: FacetStore, _ surface: FacetGallerySurface) {
        if surface == .onboarding || surface == .onboardingLoading {
            store.profiles = []
            store.selectedProfileID = nil
        }
        if surface == .onboardingLoading { store.isLoading = true }
        if surface == .opening { store.snapshot = nil }
        if surface == .consent { store.needsStandardConsent = true }
        if surface == .connected { store.syncStates[profileID] = "Connected to Obsidian Sync." }
        if surface == .paused {
            store.syncStates[profileID] = "Sync is paused. Your local tasks are available."
        }
        if surface == .reminders {
            store.reminderStatus =
                "Allow notifications in System Settings to receive task reminders."
        }
        if surface == .search { store.search = "release" }
        if surface == .retired || surface == .retiredOtherVault {
            let owner = surface == .retired ? profileID : "work-vault"
            store.pendingActions = [
                FacetPendingMutation(
                    profileID: owner, id: "00000000-0000-4000-8000-000000000001",
                    mutation: .object([
                        "mutationId": .string("00000000-0000-4000-8000-000000000001"),
                        "at": .string("2026-10-03T12:00:00Z"),
                        "command": .object([
                            "kind": .string("stop_time"), "path": .string("Tasks/old.md"),
                        ]),
                    ]))
            ]
        }
    }

    private static func snapshot(_ surface: FacetGallerySurface) throws -> FacetSnapshot {
        let empty = surface == .empty || surface == .consent
        let tasks = empty ? [] : taskValues(surface)
        let views: [FacetValue] =
            surface == .savedViews
            ? [
                savedView("today", name: "Today", scope: "today"),
                savedView("work", name: "Work priorities", scope: "all"),
            ] : []
        let problems: [FacetValue] =
            surface == .problems
            ? [
                .object([
                    "path": .string("Tasks/Needs correction.md"),
                    "message": .string("The due date needs correction in this note."),
                ])
            ] : []
        let value = FacetValue.object([
            "schemaVersion": .integer(1), "profileId": .string(profileID), "version": .integer(1),
            "tasks": .array(tasks), "totalCount": .integer(Int64(tasks.count)),
            "pendingCount": .integer(0), "pendingTaskIds": .array([]), "conflictCount": .integer(0),
            "configuration": configuration, "problems": .array(problems), "views": .array(views),
            "groups": .array([]),
        ])
        try FacetSchema.bundled().validate(value, definition: "snapshot")
        return try FacetFeatureProjection.decode(FacetSnapshot.self, from: value)
    }

    private static var configuration: FacetValue {
        .object([
            "statuses": .array([
                definition("open", "Open"), definition("doing", "In progress"),
                definition("done", "Done"),
            ]),
            "priorities": .array([definition("normal", "Normal"), definition("high", "High")]),
        ])
    }

    private static func definition(_ value: String, _ label: String) -> FacetValue {
        .object(["value": .string(value), "label": .string(label)])
    }

    private static func taskValues(_ surface: FacetGallerySurface) -> [FacetValue] {
        var properties: [String: FacetValue] = [
            "due": .string("2026-10-12"), "scheduled": .string("2026-10-09"),
            "dateCreated": .string("2026-10-08T12:00:00Z"), "projects": .array([.string("Work")]),
            "contexts": .array([.string("desk")]), "tags": .array([.string("release")]),
            "recurrence": .string("FREQ=WEEKLY"), "reminders": .array([]), "blockedBy": .array([]),
        ]
        if surface == .missingCreation { properties.removeValue(forKey: "dateCreated") }
        if surface == .relationships {
            properties["blockedBy"] = .array([
                .object([
                    "uid": .string("Tasks/Approve release.md"), "reltype": .string("FINISHTOSTART"),
                    "gap": .string("P1D"),
                ])
            ])
            properties["reminders"] = .array([
                .object([
                    "id": .string("relative"), "type": .string("relative"),
                    "relatedTo": .string("due"),
                    "offset": .string("-PT15M"), "description": .string("Review the checklist"),
                ]),
                .object([
                    "id": .string("absolute"), "type": .string("absolute"),
                    "absoluteTime": .string("2026-10-12T09:00:00Z"),
                    "description": .string("Prepare release notes"),
                ]),
            ])
        }
        let main = task("Plan release", status: "open", properties: properties, recurring: true)
        if surface == .search { return [main] }
        return [
            main, task("Review pull request", status: "doing"),
            task("Prepare vault", status: "done"),
        ]
    }

    private static func task(
        _ title: String, status: String, properties: [String: FacetValue] = [:],
        recurring: Bool = false
    ) -> FacetValue {
        let path = "Tasks/" + title + ".md"
        return .object([
            "id": .string(path), "path": .string(path), "title": .string(title),
            "status": .string(status),
            "priority": .string(status == "open" ? "high" : "normal"),
            "completed": .bool(status == "done"),
            "revision": .string(revision), "properties": .object(properties),
            "body": .string(
                "Prepare the release checklist.\n\n- [ ] Review notes\n- [ ] Confirm task reminders"
            ),
            "isRecurring": .bool(recurring), "isBlocked": .bool(false), "isBlocking": .bool(false),
            "isPending": .bool(false), "occurrenceDate": .null, "effectiveDate": .null,
        ])
    }

    private static func savedView(_ id: String, name: String, scope: String) -> FacetValue {
        .object([
            "id": .string(id), "revision": .string(revision),
            "view": .object([
                "schemaVersion": .integer(1), "name": .string(name), "viewType": .string("list"),
                "query": .object(["scope": .string(scope)]),
            ]),
        ])
    }

    static func conflict() throws -> FacetConflict {
        let value = FacetValue.object([
            "id": .string("conflict-fixture"), "path": .string("Tasks/Plan release.md"),
            "base": .null,
            "local": .object(["size": .integer(1234), "revision": .string(revision)]),
            "remote": .object(["size": .integer(2_097_152), "revision": .string(revision)]),
            "remoteRevision": .string(revision), "currentRevision": .string(revision),
        ])
        try FacetSchema.bundled().validate(value, definition: "conflict")
        return try FacetFeatureProjection.decode(FacetConflict.self, from: value)
    }

    private static func remoteVaults() throws -> [FacetRemoteVault] {
        try ["Personal vault", "Shared work vault"].enumerated().map { index, name in
            try FacetFeatureProjection.decode(
                FacetRemoteVault.self,
                from: .object([
                    "id": .string("remote-\(index)"), "name": .string(name),
                    "host": .string("fixture-sync"),
                    "region": .string("fixture"), "salt": .string(""),
                    "encryptionVersion": .integer(3),
                    "managed": .bool(index == 0), "shared": .bool(index == 1),
                ]))
        }
    }
}
