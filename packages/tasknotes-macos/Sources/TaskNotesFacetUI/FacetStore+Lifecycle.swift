public import Foundation
import OSLog
public import TaskNotesKit

extension FacetStore {
    // MARK: - Startup & Teardown

    public func start() async {
        if let existing = startupTask {
            await existing.value
            return
        }
        let task = _Concurrency.Task { @MainActor in
            do {
                try await localStore.load()
            } catch {
                errorBanner = error.localizedDescription
            }
            if !isIsolatedLaunch {
                await FacetRetiredNotifications.clearIfNeeded()
            }
            bumpRevision()
            refreshTokenPresence()

            #if os(macOS)
                do {
                    if let smoke = try FacetReleaseSmokeConfiguration.launch() {
                        try smoke.recordStartup()
                    }
                } catch {
                    Self.logger.error(
                        "Release smoke receipt failed: \(error.localizedDescription, privacy: .public)"
                    )
                }
            #endif

            if hasConfiguredToken && (!isIsolatedLaunch || serverURLString != "http://127.0.0.1:1")
            {
                await syncNow()
            }
        }
        startupTask = task
        await task.value
    }

    public func runBackgroundSync() async -> Bool {
        await start()
        guard let client = makeAPIClient() else { return false }
        do {
            try await localStore.sync(client: client)
        } catch {
            return false
        }
        bumpRevision()
        return localStore.lastError == nil
    }

    public func flushBeforeClose() async -> Bool {
        do {
            try await localStore.flushPersistence()
        } catch {
            errorBanner = error.localizedDescription
        }
        if !localStore.outbox.isEmpty, let client = makeAPIClient() {
            do {
                try await localStore.sync(client: client)
            } catch {
                // Retain offline outbox in SQLite so closing never hangs.
            }
        }
        do {
            try await localStore.flushPersistence()
        } catch {
            errorBanner = error.localizedDescription
        }
        return true
    }

    // MARK: - Undo Toast & Sensory Cues

    public var canUndo: Bool { localStore.canUndo }

    public func undoLast() {
        guard let undone = localStore.undoLast() else { return }
        completionRows = completionRows.filter { $0.value.receipt != undone.id }
        undoToastMessage = nil
        undoDismissTask?.cancel()
        feedback.trigger(.undone)
        scheduleAutoSync()
    }

    internal func undoAction(for receipt: String?) {
        guard let receipt, receipt == localStore.latestUndoEntry?.id else { return }
        undoLast()
    }

    public func dismissUndoToast() {
        undoToastMessage = nil
        undoDismissTask?.cancel()
    }

    internal func presentUndoToast(_ message: String) {
        toastReceiptID = localStore.latestUndoEntry?.id
        undoToastMessage = message
        undoDismissTask?.cancel()
        let durationMs: UInt64 = 6_000
        undoDismissTask = _Concurrency.Task { @MainActor in
            do {
                try await _Concurrency.Task.sleep(for: .milliseconds(durationMs))
                if !_Concurrency.Task.isCancelled {
                    undoToastMessage = nil
                }
            } catch {
                // Cancelled by newer toast or explicit dismissal.
            }
        }
    }

    // MARK: - Deep Links, Widget & App Intents

    public func handleURL(_ url: URL) {
        guard let parsed = TaskNotesURL(url) else { return }
        switch parsed.target {
        case .destination(let target):
            destination = target
        case .task(let taskId):
            selectedTaskId = taskId
            showsInspector = true
        case .action(let action):
            switch action {
            case .quickAdd:
                showsCapture = true
            case .queuedCapture:
                break
            case .search:
                searchFocusedRequest &+= 1
            case .settings:
                showsSettings = true
            }
        }
    }

    public func processIntentCaptures(_ queue: FacetIntentQueue) async {
        do {
            let drained = try queue.pending()
            guard !drained.isEmpty else { return }
            let defaultProject = inboxProject?.id ?? ""
            for item in drained {
                let parsed = FacetQuickCaptureParser.parse(
                    item.title,
                    projects: activeProjects,
                    sections: activeSections,
                    labels: activeLabels,
                    defaultProjectId: defaultProject,
                    calendar: calendar
                )
                if !parsed.isEmpty {
                    _ = localStore.addTask(
                        FacetTaskDraft(
                            title: parsed.title,
                            projectId: parsed.projectId,
                            sectionId: parsed.sectionId,
                            priority: parsed.priority,
                            dueDate: parsed.dueDate,
                            dueDatetime: parsed.dueDatetime,
                            dueTimezone: parsed.dueTimezone,
                            dueString: parsed.dueString,
                            deadline: parsed.deadline,
                            recurrenceBasis: parsed.recurrenceBasis,
                            recurrenceRule: parsed.recurrenceRule,
                            labelIds: parsed.labelIds
                        )
                    )
                }
                try queue.acknowledge(id: item.id)
            }
            scheduleAutoSync()
        } catch {
            errorBanner = error.localizedDescription
        }
    }

    public func widgetEnvelope() -> Data? {
        do {
            return try FacetWidgetProjection.encodeEnvelope(
                tasks: localStore.tasks,
                projects: localStore.projects,
                now: calendar.instant,
                viewerTimeZone: calendar.timeZone
            )
        } catch {
            Self.logger.error(
                "Widget projection failed: \(error.localizedDescription, privacy: .public)"
            )
            return nil
        }
    }

    public func reportNativeFailure(_ error: any Error) {
        errorBanner = error.localizedDescription
    }
}
