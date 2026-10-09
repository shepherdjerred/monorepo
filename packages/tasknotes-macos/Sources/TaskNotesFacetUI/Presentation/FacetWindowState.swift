import Foundation
public import Observation
import SwiftUI
public import TaskNotesKit

/// Window-owned queries never change the application's mutation ownership fence.
@Observable
@MainActor
public final class FacetWindowState {
    public var scope = "inbox"
    public var search = ""
    public var status = "" {
        didSet { if status != oldValue { savedQuery.removeValue(forKey: "statuses") } }
    }
    public var priority = "" {
        didSet { if priority != oldValue { savedQuery.removeValue(forKey: "priorities") } }
    }
    public var showCompleted = false {
        didSet { if showCompleted != oldValue { savedQuery.removeValue(forKey: "completed") } }
    }
    public var includeArchived = false
    public var board = false
    public var savedQuery: [String: FacetValue] = [:]
    public var selectedViewID: String?
    public var selectedTaskIDs: Set<FacetTaskRowID> = [] {
        didSet { if selectedTaskIDs != oldValue { selectionGeneration += 1 } }
    }
    public private(set) var selectionGeneration: UInt64 = 0
    public var inspectorPresented = true
    internal var feedbackOrigin: FacetFeedbackOrigin?
    internal var reducedMotion = false
    private var animatedMutationID: String?
    public internal(set) var snapshot: FacetSnapshot?
    public internal(set) var displayedQuery: FacetValue?
    public internal(set) var error: String?
    public internal(set) var isLoading = false
    public internal(set) var generation: UInt64 = 0
    public internal(set) var vocabulary: [String: [String]] = [:]
    private var vocabularyVersion: UInt64?
    private var vocabularyProfile: String?
    private var vocabularyGeneration: UInt64 = 0
    @ObservationIgnored private let clock: SystemClock

    public init(clock: SystemClock = SystemClock()) { self.clock = clock }

    internal init(store: FacetStore) {
        clock = store.clock
        snapshot = store.snapshot
        scope = store.scope == "all" ? "inbox" : store.scope
        search = store.search
    }

    public func query(offset: Int = 0) throws -> FacetValue {
        guard let exactOffset = UInt32(exactly: offset) else {
            throw FacetContractError.unsupportedResponse
        }
        let calendar = clock.viewerCalendar()
        var fields = savedQuery
        fields["schemaVersion"] = .integer(1)
        fields["scope"] = .string(scope)
        fields["offset"] = .unsigned(UInt64(exactOffset))
        fields["limit"] = .integer(100)
        fields["today"] = .string(calendar.today)
        fields["at"] = .string(calendar.instant.ISO8601Format())
        if scope == "upcoming", fields["groupBy"] == nil {
            fields["groupBy"] = .string("effectiveDate")
        }
        fields["includeArchived"] = .bool(includeArchived)
        fields["text"] = search.isEmpty ? nil : .string(search)
        if !status.isEmpty { fields["statuses"] = .array([.string(status)]) }
        if !priority.isEmpty { fields["priorities"] = .array([.string(priority)]) }
        if savedQuery["completed"] == nil {
            fields["completed"] = showCompleted || scope == "completed" ? nil : .bool(false)
        }
        return .object(fields)
    }

    public func reload(store: FacetStore) async {
        guard let profileID = store.selectedProfileID else {
            generation += 1
            snapshot = nil
            selectedTaskIDs = []
            return
        }
        do {
            let query = try query()
            await load(profileID: profileID, query: query) {
                try await store.readWindowSnapshot(profileID: profileID, query: query)
            } publish: { update in
                if let feedback = store.appliedFeedback,
                    feedback.event?.origin == self.feedbackOrigin,
                    feedback.profileID == profileID, feedback.mutationID != self.animatedMutationID,
                    feedback.event?.action != .saved, feedback.event?.noOp == false,
                    !self.reducedMotion
                {
                    self.animatedMutationID = feedback.mutationID
                    withAnimation(FacetNativeStyle.rowAnimation, update)
                } else {
                    update()
                }
            }
            if let version = snapshot?.version,
                vocabularyVersion != version || vocabularyProfile != profileID
            {
                await reloadVocabulary(store: store, profileID: profileID)
            }
        } catch { self.error = FacetFailureDiagnostic(error).action }
    }

    internal func load(
        profileID: String, query: FacetValue,
        read: () async throws -> FacetSnapshot?,
        publish: ((() -> Void) -> Void)? = nil
    ) async {
        generation += 1
        let request = generation
        isLoading = true
        defer { if request == generation { isLoading = false } }
        do {
            guard let result = try await read(), request == generation else { return }
            guard result.profileId == profileID else {
                throw FacetContractError.unsupportedResponse
            }
            if let publish { publish { snapshot = result } } else { snapshot = result }
            displayedQuery = query
            error = nil
            selectedTaskIDs.formIntersection(Set(result.tasks.map(\.rowID)))
        } catch {
            if request == generation { self.error = FacetFailureDiagnostic(error).action }
        }
    }

    public func loadMore(store: FacetStore) async {
        guard let previous = snapshot, !isLoading,
            previous.totalCount > UInt64(previous.tasks.count),
            case .object(var fields) = displayedQuery
        else { return }
        let request = generation
        isLoading = true
        defer { if request == generation { isLoading = false } }
        fields["offset"] = .integer(Int64(previous.tasks.count))
        do {
            guard
                let page = try await store.readWindowSnapshot(
                    profileID: previous.profileId, query: .object(fields)),
                generation == request
            else { return }
            guard page.version == previous.version else {
                await reload(store: store)
                return
            }
            guard !page.tasks.isEmpty else { throw FacetContractError.unsupportedResponse }
            snapshot = try previous.appending(page)
        } catch {
            if request == generation { self.error = FacetFailureDiagnostic(error).action }
        }
    }

    public func apply(_ view: FacetSavedView, store: FacetStore) async {
        guard let fields = view.view["query"]?.object?.fields else {
            error = "This saved view has no valid query. Edit it before opening it."
            return
        }
        selectedViewID = view.id
        scope = fields["scope"]?.text ?? "all"
        search = fields["text"]?.text ?? ""
        status =
            fields["statuses"]?.array?.elements.count == 1
            ? fields["statuses"]?.array?.elements.first?.text ?? "" : ""
        priority =
            fields["priorities"]?.array?.elements.count == 1
            ? fields["priorities"]?.array?.elements.first?.text ?? "" : ""
        showCompleted = fields["completed"] != .bool(false)
        includeArchived = fields["includeArchived"] == .bool(true)
        board = view.view["viewType"]?.text == "board"
        savedQuery = fields
        await reload(store: store)
    }

    internal func reloadVocabulary(
        store: FacetStore, profileID: String,
        read: ((FacetValue) async throws -> FacetSnapshot?)? = nil
    ) async {
        vocabularyGeneration += 1
        let request = vocabularyGeneration
        if vocabularyProfile != profileID {
            vocabulary = [:]
            vocabularyVersion = nil
        }
        let load =
            read ?? { query in
                try await store.readWindowSnapshot(profileID: profileID, query: query)
            }
        do {
            for _ in 0..<3 {
                var tasks: [FacetTask] = []
                var version: UInt64?
                var changed = false
                while true {
                    let query: FacetValue = .object([
                        "schemaVersion": .integer(1), "scope": .string("all"),
                        "includeArchived": .bool(false), "limit": .integer(100),
                        "offset": .integer(Int64(tasks.count)),
                    ])
                    guard
                        let page = try await load(query),
                        request == vocabularyGeneration
                    else { return }
                    if let version, version != page.version {
                        changed = true
                        break
                    }
                    version = page.version
                    tasks.append(contentsOf: page.tasks)
                    if tasks.count >= page.totalCount { break }
                    guard !page.tasks.isEmpty else { throw FacetContractError.unsupportedResponse }
                }
                if changed { continue }
                vocabulary = Self.vocabulary(tasks)
                vocabularyVersion = version
                vocabularyProfile = profileID
                return
            }
            error =
                "The vault changed while loading Browse. Refresh to load its complete projects, contexts and tags."
        } catch { self.error = FacetFailureDiagnostic(error).action }
    }

    internal static func vocabulary(_ tasks: [FacetTask]) -> [String: [String]] {
        Dictionary(
            uniqueKeysWithValues: ["projects", "contexts", "tags"].map { key in
                (
                    key,
                    Array(Set(tasks.flatMap { FacetTaskPresentation.tokens($0.properties[key]) }))
                        .sorted()
                )
            })
    }
}
