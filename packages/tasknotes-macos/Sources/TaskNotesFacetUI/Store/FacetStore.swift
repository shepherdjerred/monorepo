public import Foundation
public import Observation
public import TaskNotesKit

@MainActor
@Observable
public final class FacetStore {
    public internal(set) var profiles: [FacetProfile] = [] {
        didSet { revalidateOccurrenceProfileOwner() }
    }
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
    @ObservationIgnored internal var feedback: FacetNativeFeedback
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
    internal var navigationRequestID: UUID?
    public var showsConflicts = false
    public var showsAccount = false
    internal var accountWindowOwnerID: UUID?
    internal var conflictWindowOwnerID: UUID?
    public internal(set) var accountNeedsCode = false
    internal var accountPresentation = FacetAccountPresentation()
    public internal(set) var remoteVaults: [FacetRemoteVault] = []
    public internal(set) var vaultConnections: [FacetVaultConnection] = []
    public internal(set) var syncStates: [String: String] = [:]
    public internal(set) var syncStatuses: [String: FacetSyncStatus] = [:]
    public internal(set) var needsStandardConsent = false
    public internal(set) var occurrenceOverviews: [String: FacetOccurrenceOverview] = [:]
    public internal(set) var occurrenceIssues: [String: String] = [:]
    @ObservationIgnored internal var occurrenceQueue = FacetOccurrenceMaintenanceQueue()
    @ObservationIgnored internal var occurrenceWorker: _Concurrency.Task<Void, Never>?
    @ObservationIgnored internal var occurrenceAdmission:
        (profileID: String, permit: FacetOccurrenceAdmission)?
    @ObservationIgnored internal var occurrenceReadySessions: [String: UInt64] = [:]
    public internal(set) var capturePreview: FacetValue?
    public internal(set) var featureResult: FacetValue?
    public internal(set) var reminderStatus: String?
    internal var notificationRoute: FacetNotificationRoute?
    internal var reminderEditor: FacetReminderEditorSelection?
    @ObservationIgnored internal var reminders = FacetReminders()
    @ObservationIgnored internal var engine: FacetEngine? {
        didSet {
            if engine !== oldValue {
                occurrenceAdmission?.permit.cancel()
                feedbackSessionID = UUID()
                clearSavedNotice()
            }
        }
    }
    @ObservationIgnored internal var account: FacetObsidianAccount? {
        didSet { if account !== oldValue { occurrenceAdmission?.permit.cancel() } }
    }
    @ObservationIgnored internal var importer: FacetVaultImporter?
    @ObservationIgnored internal var sessions: [String: FacetObsidianSession] = [:]
    @ObservationIgnored internal var syncGeneration: UInt64 = 0 {
        didSet { changedOccurrenceLifecycle(previous: oldValue) }
    }
    @ObservationIgnored internal var syncSessionGenerations: [String: UInt64] = [:]
    @ObservationIgnored internal var preferences: UserDefaults
    @ObservationIgnored internal var startupTask: _Concurrency.Task<Void, Never>?
    #if os(macOS)
        @ObservationIgnored internal var releaseSmokeConfiguration: FacetReleaseSmokeConfiguration?
    #endif
    #if DEBUG
        public internal(set) var acceptanceConfiguration: FacetAcceptanceConfiguration?
        @ObservationIgnored internal var acceptanceControl: FacetAcceptanceControl?
        @ObservationIgnored internal var acceptanceVaultDirectory: URL?
        @ObservationIgnored internal var acceptanceVaultEngine: FacetEngine?
        @ObservationIgnored internal var acceptanceVaultTask: _Concurrency.Task<Void, any Error>?
    #endif
    @ObservationIgnored internal var accountTransition = false {
        didSet { if accountTransition { occurrenceAdmission?.permit.cancel() } }
    }
    @ObservationIgnored internal var foreground = true {
        didSet { if !foreground { occurrenceAdmission?.permit.cancel() } }
    }
    @ObservationIgnored internal var backgroundLease: UUID? {
        didSet {
            if oldValue != nil, backgroundLease != oldValue { occurrenceAdmission?.permit.cancel() }
        }
    }
    @ObservationIgnored internal var removingProfileIDs: Set<String> = [] {
        didSet {
            revalidateOccurrenceProfileOwner()
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

    public init(clock: SystemClock = SystemClock()) {
        self.clock = clock
        if Self.requiresIsolation {
            guard let bootstrap = UserDefaults(suiteName: "red.sjer.facet.bootstrap.\(UUID())")
            else { preconditionFailure("Private startup preferences could not be created.") }
            preferences = bootstrap
            feedback = FacetNativeFeedback(defaults: bootstrap)
        } else {
            preferences = .standard
            feedback = .shared
        }
    }

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

#if DEBUG
    extension FacetStore {
        /// Application-owned preparation survives cancelled window waiters and
        /// retains its result so restored windows cannot register or select again.
        public func prepareAcceptanceVault(_ directory: URL) async throws {
            guard let configuration = acceptanceConfiguration, let engine
            else { throw FacetAcceptanceError.invalidDescriptor }
            try configuration.requireLocalVault(directory)
            if let task = acceptanceVaultTask {
                guard acceptanceVaultDirectory == directory, acceptanceVaultEngine === engine else {
                    throw FacetAcceptanceError.invalidDescriptor
                }
                try await task.value
                return
            }
            acceptanceVaultDirectory = directory
            acceptanceVaultEngine = engine
            let task = _Concurrency.Task {
                let existing = try await engine.profiles().filter {
                    $0.name == directory.lastPathComponent
                }
                guard existing.count <= 1 else { throw FacetAcceptanceError.invalidDescriptor }
                let profile: FacetProfile
                if let registered = existing.first {
                    guard registered.kind == "local_folder", registered.approveStandard else {
                        throw FacetAcceptanceError.invalidDescriptor
                    }
                    profile = registered
                } else {
                    profile = try await engine.registerLocal(
                        directory: directory, approveStandard: true)
                }
                let registered = try await engine.profiles()
                guard self.engine === engine else { throw FacetAcceptanceError.invalidDescriptor }
                self.profiles = registered
                await self.selectProfile(profile.id)
                guard self.engine === engine, self.selectedProfileID == profile.id,
                    self.snapshot?.profileId == profile.id, self.error == nil
                else { throw FacetAcceptanceError.invalidDescriptor }
            }
            acceptanceVaultTask = task
            try await task.value
        }
    }
#endif

extension FacetStore {
    public var acceptanceDirectory: URL? {
        #if DEBUG
            acceptanceConfiguration?.stateDirectory
        #else
            nil
        #endif
    }
    public var isAcceptanceLaunch: Bool {
        Bundle.main.bundleIdentifier == "red.sjer.tasknotes.mac.acceptance"
            || CommandLine.arguments.contains("--facet-acceptance-descriptor")
            || CommandLine.arguments.contains("--facet-native-acceptance")
    }

    public var isIsolatedLaunch: Bool { Self.requiresIsolation }
    private static var requiresIsolation: Bool {
        Bundle.main.bundleIdentifier == "red.sjer.tasknotes.mac.acceptance"
            || CommandLine.arguments.contains("--facet-acceptance-descriptor")
            || CommandLine.arguments.contains("--facet-native-acceptance")
            || CommandLine.arguments.contains("--facet-release-smoke")
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
            navigationRequestID = UUID()
            #if os(macOS)
                scope = "agenda"
                _Concurrency.Task { await reloadQuery() }
            #endif
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
