import Foundation
import TaskNotesKit

extension FacetStore {
    public func start() async {
        await awaitStartup { await self.startConfigured() }
    }

    /// Windows and panels wait for the same application-owned bootstrap. A
    /// disappearing view cancels its waiter, never the shared engine startup.
    internal func awaitStartup(_ operation: @escaping @MainActor () async -> Void) async {
        if let inFlight = startupTask {
            await inFlight.value
            return
        }
        let owned = _Concurrency.Task { await operation() }
        startupTask = owned
        await owned.value
        startupTask = nil
    }

    private func startConfigured() async {
        await start {
            #if os(macOS)
                if let smoke = try FacetReleaseSmokeConfiguration.launch() {
                    self.releaseSmokeConfiguration = smoke
                    return try await self.openIsolatedStartup(
                        directory: smoke.stateDirectory, defaultsSuite: smoke.defaultsSuiteName,
                        stagingService: smoke.stagingKeychainService,
                        accountService: smoke.accountKeychainService, remoteVaultAccess: .disabled)
                }
            #endif
            #if DEBUG
                if let acceptance = try FacetAcceptanceConfiguration.launch() {
                    self.acceptanceConfiguration = acceptance
                    return try await self.openIsolatedStartup(
                        directory: acceptance.stateDirectory,
                        defaultsSuite: acceptance.defaultsSuiteName,
                        stagingService: acceptance.stagingKeychainService,
                        accountService: acceptance.accountKeychainService,
                        remoteVaultAccess: acceptance.remoteVaultAccess)
                }
            #endif
            guard !self.isIsolatedLaunch else {
                throw FacetAcceptanceError.wrongApplication
            }
            let support = try FileManager.default.url(
                for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil,
                create: true)
            return try await FacetStartupState.open(
                directory: support.appendingPathComponent("Facet"))
        }
    }

    private func openIsolatedStartup(
        directory: URL, defaultsSuite: String, stagingService: String, accountService: String,
        remoteVaultAccess: FacetRemoteVaultAccess
    ) async throws -> FacetStartupState {
        guard let scopedPreferences = UserDefaults(suiteName: defaultsSuite) else {
            throw FacetAcceptanceError.invalidDescriptor
        }
        preferences = scopedPreferences
        feedback = FacetNativeFeedback(defaults: scopedPreferences)
        reminders = try FacetReminders(defaultsSuiteName: defaultsSuite)
        return try await FacetStartupState.open(
            directory: directory,
            openEngine: {
                try await FacetEngine.open(
                    directory: $0, secrets: FacetKeychainStore(service: stagingService))
            },
            openAccount: {
                try await FacetObsidianAccount.open(
                    directory: $0, secrets: FacetKeychainStore(service: accountService),
                    remoteVaultAccess: remoteVaultAccess)
            })
    }

    internal func start(prepare: () async throws -> FacetStartupState) async {
        guard engine == nil, !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let ready = try await prepare()
            error = nil
            engine = ready.engine
            importer = ready.importer
            account = ready.account
            pendingImports = ready.pendingImports
            profiles = ready.profiles
            pendingActions = ready.pendingActions
            await restoreAccountSession(startup: true)
            let saved = preferences.string(forKey: "Facet.selectedProfile")
            selectedProfileID = profiles.first(where: { $0.id == saved })?.id ?? profiles.first?.id
            await refresh()
            for profile in profiles { requestOccurrenceMaintenance(profileID: profile.id) }
            if foreground { await resumeSync() }
            #if os(macOS)
                if let smoke = releaseSmokeConfiguration {
                    guard error == nil else { throw FacetAcceptanceError.invalidDescriptor }
                    try smoke.recordStartup()
                }
            #endif
            #if DEBUG
                startAcceptanceControl()
            #endif
        } catch {
            if foreground {
                self.error = error.localizedDescription
            } else {
                reportBackgroundFailure(error)
            }
        }
    }
}
