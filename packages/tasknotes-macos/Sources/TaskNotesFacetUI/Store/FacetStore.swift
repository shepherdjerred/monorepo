public import Foundation
public import Observation
public import TaskNotesKit

@MainActor
@Observable
public final class FacetStore {
    public internal(set) var profiles: [FacetProfile] = []
    public internal(set) var pendingImports: [FacetVaultImport] = []
    public internal(set) var selectedProfileID: String? {
        didSet {
            if selectedProfileID != oldValue {
                selectionGeneration += 1
                clearSavedNotice()
            }
        }
    }
    public internal(set) var snapshot: FacetSnapshot?
    public internal(set) var error: String?
    public internal(set) var savedNotice: String?
    internal var appliedFeedback: FacetAppliedFeedback?
    @ObservationIgnored internal var feedbackSessionID = UUID()
    @ObservationIgnored internal var feedbackOrigin: FacetFeedbackOrigin?
    @ObservationIgnored internal var feedback = FacetNativeFeedback.shared
    public internal(set) var isLoading = false
    public internal(set) var conflicts: [FacetConflict] = []
    public internal(set) var conflictCursor: String?
    public internal(set) var pendingActions: [FacetPendingMutation] = []
    public var scope = "all"
    public var search = ""
    public var status = "" {
        didSet { if !isApplyingView { savedQuery.removeValue(forKey: "statuses") } }
    }
    public var priority = "" {
        didSet { if !isApplyingView { savedQuery.removeValue(forKey: "priorities") } }
    }
    public var showCompleted = false {
        didSet { if !isApplyingView { savedQuery.removeValue(forKey: "completed") } }
    }
    public var includeArchived = false
    public var savedQuery: [String: FacetValue] = [:]
    public internal(set) var selectedViewID: String?
    public var approveStandard = false
    public var captureTitle = "" {
        didSet {
            if captureProfileID == nil, !captureTitle.isEmpty {
                captureProfileID = selectedProfileID
            }
            if captureTitle != oldValue, !isSaving {
                captureMutationID = UUID().uuidString
                captureCommand = nil
                capturePreview = nil
            }
        }
    }
    public var showsCapture = false {
        didSet { if showsCapture, captureProfileID == nil { captureProfileID = selectedProfileID } }
    }
    public var showsConflicts = false
    public var showsAccount = false
    public internal(set) var accountNeedsCode = false
    public internal(set) var remoteVaults: [FacetRemoteVault] = []
    public internal(set) var vaultConnections: [FacetVaultConnection] = []
    public internal(set) var syncStates: [String: String] = [:]
    public internal(set) var needsStandardConsent = false
    public internal(set) var capturePreview: FacetValue?
    public internal(set) var featureResult: FacetValue?
    public internal(set) var reminderStatus: String?
    internal var notificationRoute: FacetNotificationRoute?
    internal var reminderEditor: FacetReminderEditorSelection?
    @ObservationIgnored internal let reminders = FacetReminders()
    @ObservationIgnored internal var engine: FacetEngine? {
        didSet {
            if engine !== oldValue {
                feedbackSessionID = UUID()
                clearSavedNotice()
            }
        }
    }
    @ObservationIgnored internal var account: FacetObsidianAccount?
    @ObservationIgnored internal var importer: FacetVaultImporter?
    @ObservationIgnored internal var sessions: [String: FacetObsidianSession] = [:]
    @ObservationIgnored internal var syncGeneration: UInt64 = 0 {
        didSet { if syncGeneration != oldValue { clearSavedNotice() } }
    }
    @ObservationIgnored internal var accountTransition = false
    @ObservationIgnored internal var foreground = true
    @ObservationIgnored internal var backgroundLease: UUID?
    @ObservationIgnored internal var removingProfileIDs: Set<String> = [] {
        didSet {
            if let selectedProfileID, removingProfileIDs.contains(selectedProfileID) {
                clearSavedNotice()
            }
        }
    }
    @ObservationIgnored internal var requestGeneration: UInt64 = 0 {
        didSet { if requestGeneration != oldValue { savedNotice = nil } }
    }
    @ObservationIgnored internal var selectionGeneration: UInt64 = 0
    @ObservationIgnored internal let clock: SystemClock
    @ObservationIgnored internal let actionCoordinator = FacetActionCoordinator()
    @ObservationIgnored internal var displayedQuery: FacetValue?
    @ObservationIgnored internal var captureMutationID = UUID().uuidString
    @ObservationIgnored internal var captureCommand: FacetValue?
    @ObservationIgnored internal var captureProfileID: String?
    @ObservationIgnored internal var previewGeneration: UInt64 = 0
    @ObservationIgnored internal var isApplyingView = false
    @ObservationIgnored internal var activeMutationID: String? {
        didSet { if activeMutationID != nil, activeMutationID != oldValue { clearSavedNotice() } }
    }
    public internal(set) var isSaving = false {
        didSet { if isSaving, !oldValue { clearSavedNotice() } }
    }

    public init(clock: SystemClock = SystemClock()) { self.clock = clock }

    public func widgetEnvelope() async -> Data? {
        guard let engine, let profileID = selectedProfileID, snapshot != nil else { return nil }
        return await loadWidgetEnvelope(
            profileID: profileID, load: { try await engine.widgetEnvelope(profileID: profileID) },
            ownsEngine: { self.engine === engine })
    }

    internal func loadWidgetEnvelope(
        profileID: String, load: () async throws -> Data, ownsEngine: () -> Bool
    ) async -> Data? {
        let generation = requestGeneration
        let lifecycle = syncGeneration
        do {
            let data = try await load()
            guard generation == requestGeneration, lifecycle == syncGeneration,
                profileID == selectedProfileID, ownsEngine()
            else { return nil }
            return data
        } catch {
            guard generation == requestGeneration, lifecycle == syncGeneration,
                profileID == selectedProfileID, ownsEngine()
            else { return nil }
            reportNativeFailure(error)
            return nil
        }
    }

    public func reportNativeFailure(_ failure: any Error) {
        error = FacetFailureDiagnostic(failure).action
    }

    #if DEBUG
        /// A real, private Markdown vault for native acceptance runs. Release
        /// onboarding always uses a user-selected provider or Obsidian account.
        public func prepareAcceptanceVault(_ directory: URL) async {
            if let existing = profiles.first(where: { $0.name == directory.lastPathComponent }) {
                await selectProfile(existing.id)
                return
            }
            approveStandard = true
            await openLocal(directory)
            approveStandard = false
        }
    #endif

    public func start() async {
        guard engine == nil, !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let support = try FileManager.default.url(
                for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil,
                create: true)
            let opened = try await FacetEngine.open(
                directory: support.appendingPathComponent("Facet"))
            engine = opened
            let imports = try FacetVaultImporter(
                directory: support.appendingPathComponent("Facet/imports"))
            importer = imports
            pendingImports = try await imports.pending()
            account = try await FacetObsidianAccount.open(
                directory: support.appendingPathComponent("Facet/accounts"))
            profiles = try await opened.profiles()
            pendingActions = try await opened.pendingMutations()
            let saved = UserDefaults.standard.string(forKey: "Facet.selectedProfile")
            selectedProfileID = profiles.first(where: { $0.id == saved })?.id ?? profiles.first?.id
            await refresh()
            if foreground { await resumeSync() }
        } catch {
            if foreground {
                self.error = error.localizedDescription
            } else {
                reportBackgroundFailure(error)
            }
        }
    }

    public func openLocal(_ directory: URL) async {
        guard let engine else { return }
        do {
            let profile = try await engine.registerLocal(
                directory: directory, approveStandard: approveStandard)
            profiles = try await engine.profiles()
            await selectProfile(profile.id)
        } catch { self.error = error.localizedDescription }
    }

    public func resumeSavedAction(_ action: FacetPendingMutation) async {
        guard let engine, !isSaving else { return }
        guard action.canResume else {
            error = FacetDraftError.retiredFeature.localizedDescription
            return
        }
        let ownsPresentation = presentationOwner(
            profileID: action.profileID, ownsEngine: { self.engine === engine })
        _ = await runSavedAction(
            action: (mutationID: action.id, profileID: action.profileID),
            ownsEngine: { self.engine === engine },
            apply: { try await engine.retryMutation(id: action.id) },
            cleanup: { try await engine.discardObservedMutation(id: action.id) },
            reload: {
                await self.refreshSavedActions(
                    ownsPresentation: ownsPresentation,
                    load: { try await engine.pendingMutations() })
                if ownsPresentation() { await self.reloadQuery(preservingSavedNotice: true) }
            })
    }

    public func approveStandardConfiguration() async {
        guard let engine, let profile = profiles.first(where: { $0.id == selectedProfileID }) else {
            return
        }
        do {
            try await engine.approveStandard(profile: profile)
            needsStandardConsent = false
            profiles = try await engine.profiles()
            await refresh()
        } catch { self.error = error.localizedDescription }
    }

    public func removeProfile(_ profile: FacetProfile) async {
        _ = await FacetDraftCoordinator.shared.transition(owner: self, profileID: profile.id) {
            await self.removeProfileAfterDrafts(profile)
        }
    }

    private func removeProfileAfterDrafts(_ profile: FacetProfile) async {
        guard let engine else { return }
        let capturedAccount = account
        await removeProfileWithOperations(
            profileID: profile.id,
            operations: FacetProfileRemovalOperations(
                stop: {
                    if let session = self.sessions.removeValue(forKey: profile.id) {
                        await session.stop()
                    }
                },
                removeDomain: { try await engine.removeProfile(id: profile.id) },
                detach: { try await capturedAccount?.detachProfile(profileID: profile.id) },
                retire: { await self.reminders.cancel(profileIDs: [profile.id]) },
                reload: { try await engine.profiles() },
                ownsEngine: { self.engine === engine },
                reconcile: { if self.foreground { await self.resumeSync() } }))
    }
}

extension FacetStore {
    public func feedbackIntent(origin: FacetFeedbackOrigin?) -> FacetFeedbackIntent {
        let owner = origin ?? feedbackOrigin
        return FacetFeedbackIntent(origin: owner, activationID: feedback.activation(for: owner))
    }
    public func setFeedbackScene(_ origin: FacetFeedbackOrigin, active: Bool) {
        feedback.setScene(origin, active: active)
        if active {
            feedbackOrigin = origin
        } else if feedbackOrigin == origin {
            feedbackOrigin = nil
        }
    }

    public func clearError() { error = nil }
    public func clearSavedNotice() {
        savedNotice = nil
        appliedFeedback = nil
    }

    public func handleURL(_ url: URL) {
        if url.host == "today" {
            scope = "agenda"
            _Concurrency.Task { await reloadQuery() }
            return
        }
        if url.host == "quick-add" {
            captureTitle =
                URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: {
                    $0.name == "initialText"
                })?.value ?? ""
            showsCapture = true
        }
    }
}
