import Foundation
import SwiftUI
import TaskNotesKit

struct FacetTimingView: View {
    let store: FacetStore
    let profileID: String
    let task: FacetTask?
    @State private var pomodoro: FacetPomodoro?
    @State private var report: FacetTimeReport?
    @State private var from: Date
    @State private var to: Date
    @State private var minutes = 25
    @State private var failure: String?
    private let deviceID = FacetDeviceIdentity.id

    init(store: FacetStore, profileID: String, task: FacetTask?, now: Date = Date.now) {
        self.store = store
        self.profileID = profileID
        self.task = task
        _from = State(initialValue: now.addingTimeInterval(-7 * 86_400))
        _to = State(initialValue: now)
    }

    var body: some View {
        Form {
            if let task {
                Section(task.title) {
                    let active =
                        store.snapshot?.tasks.first(where: {
                            FacetTrackingPath.same($0.path, task.path)
                        })?
                        .hasActiveTimeSession ?? task.hasActiveTimeSession
                    Button(active ? "Stop tracking" : "Start tracking") {
                        changeTracking(task, active: active)
                    }.disabled(store.isSaving)
                    if let history = store.trackingHistory,
                        FacetTrackingPath.same(history.taskPath, task.path),
                        history.profileId == profileID
                    {
                        LabeledContent("Time entries", value: "\(history.totalCount)")
                        ForEach(history.rows) { entry in
                            VStack(alignment: .leading) {
                                Text(entry.startedAt)
                                Text("\(entry.elapsedSeconds / 60) minutes")
                                if let end = entry.endedAt {
                                    Text("Until \(end)")
                                }
                            }.font(.caption)
                        }
                        trackingProblems(history.problems, count: history.problemCount)
                        if history.nextCursor != nil { moreTracking }
                    }
                }
            } else if let sessions = store.trackingSessions, sessions.profileId == profileID {
                Section("Running sessions") {
                    if sessions.rows.isEmpty { Text("No tasks are currently tracking time.") }
                    ForEach(sessions.rows) { session in
                        VStack(alignment: .leading) {
                            Text(session.title)
                            Text("\(session.elapsedSeconds / 60) minutes")
                                .font(.caption)
                            if !session.projectLabels.isEmpty {
                                Text(session.projectLabels.joined(separator: ", ")).font(.caption)
                            }
                        }
                    }
                    trackingProblems(sessions.problems, count: sessions.problemCount)
                    if sessions.nextCursor != nil { moreTracking }
                }
            }
            if let pomodoro {
                Section("Pomodoro") {
                    LabeledContent("State", value: pomodoro.status.capitalized)
                    LabeledContent("Elapsed", value: "\(pomodoro.elapsedSeconds / 60) minutes")
                    if let path = pomodoro.taskPath { Text(path).font(.caption) }
                    Stepper("Duration: \(minutes) minutes", value: $minutes, in: 1...1440)
                    HStack {
                        if pomodoro.status == "running" {
                            pomodoroButton("Pause", action: "pause")
                        } else if pomodoro.status == "paused" {
                            pomodoroButton("Resume", action: "resume")
                        } else {
                            pomodoroButton("Start", action: "start")
                        }
                        if ["running", "paused"].contains(pomodoro.status) {
                            pomodoroButton("Stop", action: "stop")
                        }
                    }.disabled(store.isSaving)
                }
            }
            Section("Time report") {
                DatePicker("From", selection: $from)
                DatePicker("To", selection: $to)
                Button("Generate report") { _Concurrency.Task { await loadReport() } }
                    .disabled(from >= to)
                if let report {
                    LabeledContent("Total", value: "\(report.totalMinutes) minutes")
                    ForEach(report.rows) { row in
                        LabeledContent(row.title, value: "\(row.minutes) minutes")
                    }
                }
            }
            if let failure { Text(failure).foregroundStyle(.red) }
        }
        .formStyle(.grouped)
        .navigationTitle("Time and focus")
        .task { await load() }
        .refreshable { await load() }
        .toolbar { Button("Refresh") { _Concurrency.Task { await load() } } }
    }

    private func load() async {
        let at = FacetValue.string(Date.now.ISO8601Format())
        await store.loadTracking(profileID: profileID, path: task?.path)
        if let value = await store.readFeature(
            ["kind": .string("pomodoro"), "deviceId": .string(deviceID), "at": at],
            profileID: profileID)
        {
            do {
                pomodoro = try FacetFeatureProjection.decode(FacetPomodoro.self, from: value)
            } catch { failure = error.localizedDescription }
        }
    }

    private var moreTracking: some View {
        Button("Next page") { _Concurrency.Task { await store.loadMoreTracking() } }
            .disabled(store.trackingContinuation == nil)
    }

    @ViewBuilder
    private func trackingProblems(_ problems: [FacetTrackingProblem], count: UInt64) -> some View {
        if count > 0 {
            Text("\(count) notes have time tracking data that needs attention.")
                .font(.caption)
            ForEach(Array(problems.enumerated()), id: \.offset) { _, problem in
                Text(problem.taskPath).font(.caption)
            }
        }
    }

    private func loadReport() async {
        guard
            let value = await store.readFeature(
                [
                    "kind": .string("time_report"), "from": .string(from.ISO8601Format()),
                    "to": .string(to.ISO8601Format()), "at": .string(Date.now.ISO8601Format()),
                ], profileID: profileID)
        else { return }
        do { report = try FacetFeatureProjection.decode(FacetTimeReport.self, from: value) } catch {
            failure = error.localizedDescription
        }
    }

    private func changeTracking(_ task: FacetTask, active: Bool) {
        _Concurrency.Task {
            let saved = await store.perform(
                [
                    "kind": .string(active ? "stop_time" : "start_time"),
                    "path": .string(task.path),
                ], profileID: profileID)
            if saved { await load() }
        }
    }

    private func pomodoroButton(_ title: String, action: String) -> some View {
        Button(title) {
            let command: [String: FacetValue] = [
                "kind": .string("pomodoro"), "deviceId": .string(deviceID),
                "action": .string(action),
                "taskPath": task.map { .string($0.path) } ?? .null,
                "durationSeconds": .integer(Int64(minutes * 60)),
            ]
            _Concurrency.Task {
                if await store.perform(command, profileID: profileID) { await load() }
            }
        }
    }
}

@MainActor
private enum FacetDeviceIdentity {
    static let id: String = {
        let key = "Facet.deviceID"
        if let existing = UserDefaults.standard.string(forKey: key) { return existing }
        let created = UUID().uuidString
        UserDefaults.standard.set(created, forKey: key)
        return created
    }()
}
