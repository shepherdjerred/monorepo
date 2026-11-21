public import Foundation
import OSLog
public import Observation
public import SwiftUI
public import TaskNotesKit

/// Per-window keyboard and menu command hooks exposed via `FocusedValues`.
public struct FacetWindowCommandActions {
    public let hasSelection: Bool
    public let inspectorPresented: Bool
    public let newTask: @MainActor () -> Void
    public let delete: @MainActor () -> Void
    public let complete: @MainActor () -> Void
    public let find: @MainActor () -> Void
    public let toggleInspector: @MainActor () -> Void
    public let navigate: @MainActor (String) -> Void
    public let refresh: @MainActor () -> Void

    public init(
        hasSelection: Bool,
        inspectorPresented: Bool,
        newTask: @escaping @MainActor () -> Void,
        delete: @escaping @MainActor () -> Void,
        complete: @escaping @MainActor () -> Void,
        find: @escaping @MainActor () -> Void,
        toggleInspector: @escaping @MainActor () -> Void,
        navigate: @escaping @MainActor (String) -> Void,
        refresh: @escaping @MainActor () -> Void
    ) {
        self.hasSelection = hasSelection
        self.inspectorPresented = inspectorPresented
        self.newTask = newTask
        self.delete = delete
        self.complete = complete
        self.find = find
        self.toggleInspector = toggleInspector
        self.navigate = navigate
        self.refresh = refresh
    }
}

private struct FacetWindowCommandsKey: FocusedValueKey {
    typealias Value = FacetWindowCommandActions
}

extension FocusedValues {
    public var facetWindowCommands: FacetWindowCommandActions? {
        get { self[FacetWindowCommandsKey.self] }
        set { self[FacetWindowCommandsKey.self] = newValue }
    }
}

/// Project presentation mode (Todoist List vs Board).
public enum FacetProjectLayout: String, CaseIterable, Codable, Sendable, Equatable {
    case list
    case board

    public var title: String {
        switch self {
        case .list: "List"
        case .board: "Board"
        }
    }

    public var systemImage: String {
        switch self {
        case .list: "list.bullet"
        case .board: "rectangle.split.3x1"
        }
    }
}

/// Shared `@MainActor` Observable store coordinating SQLite persistence, `/api/v1/sync`,
/// Keychain credentials, notifications, sensory feedback, and Todoist workspace state.
@Observable
@MainActor
public final class FacetStore {
    internal static let logger = Logger(subsystem: "red.sjer.facet", category: "Store")

    public let localStore: FacetLocalStore
    public let feedback: FacetFeedbackController
    public let isIsolatedLaunch: Bool

    private var navigationTarget: FacetDestination = .section(.today)
    public var destination: FacetDestination {
        get { resolvedDestination(navigationTarget) }
        set { navigationTarget = newValue }
    }
    private var inspectorTaskId: String?
    public var selectedTaskId: String? {
        get { inspectorTaskId.map(localStore.resolvedID) }
        set { inspectorTaskId = newValue }
    }
    public var searchQuery: String = ""
    public var searchFocusedRequest: Int = 0
    public var showsInspector: Bool = false
    #if os(iOS)
        internal var bulkScheduleRequest: FacetBulkScheduleRequest?
    #endif
    public var showsCapture: Bool = false
    public var showsSettings: Bool = false
    public var upcomingSelectedDate: String?
    internal var captureDestination: FacetDestination?
    internal var captureSectionId: String?
    public var upcomingSelectedDayOffset: Int {
        get {
            guard let upcomingSelectedDate,
                let date = ViewerCalendar.date(
                    fromCivil: upcomingSelectedDate, timeZone: calendar.timeZone)
            else { return 0 }
            return calendar.gregorianCalendar.dateComponents(
                [.day], from: calendar.gregorianCalendar.startOfDay(for: calendar.instant), to: date
            ).day ?? 0
        }
        set { upcomingSelectedDate = calendar.addingDays(newValue) }
    }
    public var projectLayouts: [String: FacetProjectLayout] = [:] {
        didSet {
            defaults.set(projectLayouts.mapValues(\.rawValue), forKey: "Facet.projectLayouts")
        }
    }
    internal var projectSorts: [String: String] {
        didSet { defaults.set(projectSorts, forKey: "Facet.projectSorts") }
    }
    internal var projectGroups: [String: String] {
        didSet { defaults.set(projectGroups, forKey: "Facet.projectGroups") }
    }

    public internal(set) var serverURLString: String
    public internal(set) var hasConfiguredToken: Bool = false
    public internal(set) var errorBanner: String?
    public internal(set) var undoToastMessage: String?
    internal var toastReceiptID: String?
    internal var completionRows: [String: FacetCompletionRow] = [:]
    @ObservationIgnored internal var completionCollapseTask: _Concurrency.Task<Void, Never>?
    public var completionReceipts: [String: String] { completionRows.mapValues(\.receipt) }
    public internal(set) var dataRevision: UInt64 = 0

    public var calendar: ViewerCalendar

    internal let serverConfig: FacetServerConfiguration
    internal let tokenStore: any ServerTokenStore
    internal let defaults: UserDefaults
    internal let urlSession: URLSession
    @ObservationIgnored internal var startupTask: _Concurrency.Task<Void, Never>?
    @ObservationIgnored internal var undoDismissTask: _Concurrency.Task<Void, Never>?

    public convenience init() {
        let arguments = CommandLine.arguments
        let standardDefaults = UserDefaults.standard
        let uiTesting = arguments.contains(UITesting.flagArgument)
        let releaseSmoke = arguments.contains("--facet-release-smoke")
        let isolated = uiTesting || releaseSmoke

        let tokenBackend = Self.resolveTokenBackend(isolated: isolated, defaults: standardDefaults)
        let database = Self.openDefaultDatabase(
            releaseSmoke: releaseSmoke, defaults: standardDefaults)

        self.init(
            localStore: FacetLocalStore(database: database),
            tokenStore: tokenBackend,
            serverConfig: FacetServerConfiguration(),
            defaults: standardDefaults,
            calendar: ViewerCalendar(),
            isIsolatedLaunch: isolated
        )
    }

    public init(
        localStore: FacetLocalStore,
        tokenStore: any ServerTokenStore = InMemoryTokenStore(),
        serverConfig: FacetServerConfiguration = FacetServerConfiguration(),
        defaults: UserDefaults = .standard,
        urlSession: URLSession = .shared,
        calendar: ViewerCalendar = ViewerCalendar(),
        isIsolatedLaunch: Bool = true
    ) {
        self.localStore = localStore
        self.tokenStore = tokenStore
        self.serverConfig = serverConfig
        self.defaults = defaults
        projectSorts = defaults.dictionary(forKey: "Facet.projectSorts") as? [String: String] ?? [:]
        projectGroups =
            defaults.dictionary(forKey: "Facet.projectGroups") as? [String: String] ?? [:]
        let layouts =
            defaults.dictionary(forKey: "Facet.projectLayouts") as? [String: String] ?? [:]
        projectLayouts = layouts.compactMapValues(FacetProjectLayout.init(rawValue:))
        self.urlSession = urlSession
        self.calendar = calendar
        self.isIsolatedLaunch = isIsolatedLaunch
        self.serverURLString = serverConfig.baseURLString()
        self.feedback = FacetFeedbackController(
            defaults: defaults,
            enabledForLaunch: !isIsolatedLaunch
        )
        refreshTokenPresence()
    }

    private static func resolveTokenBackend(
        isolated: Bool,
        defaults: UserDefaults
    ) -> any ServerTokenStore {
        guard isolated else { return KeychainTokenStore() }
        let seeded = defaults.string(forKey: UITesting.authTokenDefaultsKey)
        let normalized =
            seeded?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            ? seeded : nil
        return InMemoryTokenStore(token: normalized)
    }

    private static func openDefaultDatabase(
        releaseSmoke: Bool,
        defaults: UserDefaults
    ) -> FacetSQLiteDatabase? {
        do {
            if releaseSmoke {
                return try FacetSQLiteDatabase(inMemoryNamed: ":memory:")
            }
            let folder =
                defaults.string(forKey: UITesting.storageFolderDefaultsKey)
                .flatMap { $0.isEmpty ? nil : $0 } ?? "Facet"
            let dbURL = try FacetSQLiteDatabase.defaultDatabaseURL(folderName: folder)
            return try FacetSQLiteDatabase(fileURL: dbURL)
        } catch {
            logger.error(
                "SQLite open failed; running in-memory: \(error.localizedDescription, privacy: .public)"
            )
            return nil
        }
    }

    // MARK: - Server Connection & Sync

    public var isSyncing: Bool { localStore.isSyncing }
    public var pendingOutboxCount: Int { localStore.outbox.count }
    public var syncToken: String? { localStore.syncToken }

    public var effectiveError: String? {
        errorBanner ?? localStore.lastError
    }

    public func clearError() {
        errorBanner = nil
        localStore.lastError = nil
    }

    public func saveConnection(urlString: String, apiToken: String) async -> Bool {
        do {
            let validatedURL = try serverConfig.setBaseURLString(urlString)
            serverURLString = validatedURL.absoluteString
        } catch {
            errorBanner = error.localizedDescription
            return false
        }

        let trimmedToken = apiToken.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedToken.isEmpty {
            if let keychainError = tokenStore.setToken(trimmedToken) {
                errorBanner = keychainError.localizedDescription
                return false
            }
        }
        refreshTokenPresence()
        clearError()
        if hasConfiguredToken {
            await syncNow()
        }
        return localStore.lastError == nil && errorBanner == nil
    }

    public func disconnectServer() {
        if let keychainError = tokenStore.setToken(nil) {
            errorBanner = keychainError.localizedDescription
            return
        }
        refreshTokenPresence()
    }

    public func syncNow() async {
        guard let client = makeAPIClient() else { return }
        do {
            try await localStore.sync(client: client)
            resolveProjectPreferences()
        } catch {
            // `localStore.lastError` records the sync failure message.
        }
        bumpRevision()
    }

    internal func scheduleAutoSync() {
        bumpRevision()
        guard let client = makeAPIClient() else { return }
        if isIsolatedLaunch && serverURLString == "http://127.0.0.1:1" {
            return
        }
        _Concurrency.Task { @MainActor in
            do {
                try await localStore.sync(client: client)
                resolveProjectPreferences()
            } catch {
                // `localStore.lastError` surfaces the failure.
            }
            bumpRevision()
        }
    }

    internal func makeAPIClient() -> FacetAPIClient? {
        switch tokenStore.token() {
        case .failure(let error):
            errorBanner = error.localizedDescription
            return nil
        case .success(let maybeToken):
            guard let token = maybeToken?.trimmingCharacters(in: .whitespacesAndNewlines),
                !token.isEmpty
            else {
                return nil
            }
            do {
                let baseURL = try serverConfig.validatedBaseURL()
                return FacetAPIClient(baseURL: baseURL, authToken: token, session: urlSession)
            } catch {
                errorBanner = error.localizedDescription
                return nil
            }
        }
    }

    internal func refreshTokenPresence() {
        switch tokenStore.token() {
        case .success(let token):
            let trimmed = token?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            hasConfiguredToken = !trimmed.isEmpty
        case .failure(let error):
            hasConfiguredToken = false
            errorBanner = error.localizedDescription
        }
    }

    internal func bumpRevision() {
        dataRevision &+= 1
    }
}
