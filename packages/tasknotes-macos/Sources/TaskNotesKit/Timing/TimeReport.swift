// The whole module rather than the two named types, unlike its neighbours:
// `Duration.UnitsFormatStyle` is a *nested* type, and `import struct
// Foundation.Duration.UnitsFormatStyle` is not a spelling Swift has. `Locale`
// is public here — it is a parameter of this type's API — and every import of
// one module within a file must agree on its access level.
public import Foundation
public import TaskNotesUniFFI

/// The time report, as the window renders it.
///
/// ## 🔴 The report is a server aggregate, and the core cannot fetch it —
/// reported gap
///
/// `TimeSummary`, `TopTask` and `TaskTime` are exported records, and
/// `domain/wire.rs` already carries `WireTimeSummary → TimeSummary` **with
/// tests** — but nothing calls it. There is no `/api/time/summary` in
/// `net/endpoints.rs` and no exported function, so the period-scoped report the
/// React Native app shows (`client.getTimeSummary(period)`, over `today`,
/// `week` or `all`) is unreachable from Swift without the shell re-growing the
/// wire layer Phase 4.5 deleted.
///
/// So this window shows **all-time totals derived locally**, through
/// ``ofTrackedTotals(tasks:)``. That is a narrower report, and it is honest
/// about being one: `totalTrackedTime` is a value the *server* computed and put
/// on the task, so nothing here is a second implementation of the aggregation —
/// it is the same numbers, re-projected, with no period filter because
/// filtering by period would mean re-deriving totals from `timeEntries`, and
/// that genuinely is core logic.
///
/// ``of(summary:)`` is the other half of the seam, already written: the day
/// `time_summary(period:)` lands, the window calls it and everything below this
/// line is unchanged.
///
/// ## ⚠️ `elapsedFormat` is deliberately not used here
///
/// The core's `elapsedFormat` is `H:MM:SS` — a **timer** format, sized so a
/// running clock does not change width every minute. Reading `1:30:00` as "an
/// hour and a half of work" takes a beat, because that shape means a video
/// length everywhere else. A report is read, not watched, so durations here go
/// through `Duration.UnitsFormatStyle` and come out as `1 hr, 30 min` in the
/// viewer's own language. The timer keeps `elapsedFormat`, where a ticking
/// clock is exactly right.
public struct TimeReport: Sendable, Equatable {
    /// Whole minutes across everything in scope.
    public let totalMinutes: UInt32

    /// The tracked tasks, busiest first.
    public let rows: [TimeReportRow]

    public var isEmpty: Bool { rows.isEmpty }

    /// The report the server aggregated.
    ///
    /// The order is the server's and is **not** re-sorted here, for the same
    /// reason `TaskNotesStore.tasks` is not: an ordering decided in one client
    /// and silently overridden in another is how two clients start disagreeing
    /// about the same data.
    public static func of(summary: TimeSummary) -> TimeReport {
        let total = summary.totalTime
        return TimeReport(
            totalMinutes: total,
            rows: summary.topTasks.map { task in
                TimeReportRow(
                    taskId: task.taskId,
                    title: task.title,
                    minutes: task.minutes,
                    share: share(of: task.minutes, in: total)
                )
            }
        )
    }

    /// All-time totals, from what the server already put on each task.
    ///
    /// Sorted here — unlike ``of(summary:)`` — because there is no server order
    /// to preserve: this is a set of per-task values with no ranking attached,
    /// and a report whose rows were in vault order would not be a report. Ties
    /// break on title so the window does not reshuffle between reads.
    public static func ofTrackedTotals(tasks: [CoreTask]) -> TimeReport {
        let tracked =
            tasks
            .filter { $0.totalTrackedTime > 0 }
            .sorted { left, right in
                left.totalTrackedTime == right.totalTrackedTime
                    ? left.title < right.title
                    : left.totalTrackedTime > right.totalTrackedTime
            }
        let total = tracked.reduce(UInt32(0)) { $0 + $1.totalTrackedTime }
        return TimeReport(
            totalMinutes: total,
            rows: tracked.map { task in
                TimeReportRow(
                    taskId: task.id,
                    title: task.title,
                    minutes: task.totalTrackedTime,
                    share: share(of: task.totalTrackedTime, in: total)
                )
            }
        )
    }

    /// A duration in whole minutes, spelled for reading rather than for
    /// watching.
    ///
    /// `Duration.UnitsFormatStyle` rather than a hand-built string, because the
    /// unit names, their order, and the separator between them are all
    /// locale-bound — the same reason `TaskDateText` exists and the same reason
    /// the plan leaves date wording to the shell.
    ///
    /// Zero is spelled `0 min` rather than left blank: a row cannot reach this
    /// with no time on it, but the **total** can, and an empty cell beside the
    /// word "Total" reads as a rendering bug rather than as a number.
    public static func text(minutes: UInt32, locale: Locale = .autoupdatingCurrent) -> String {
        let duration = Duration.seconds(Int64(minutes) * 60)
        guard minutes >= 60 else {
            // `zeroValueUnits: .show` rather than the default `.hide`, which
            // formats a zero duration as an empty string.
            return duration.formatted(
                .units(
                    allowed: [.minutes],
                    width: .abbreviated,
                    zeroValueUnits: .show(length: 1)
                ).locale(locale)
            )
        }
        return duration.formatted(
            .units(
                allowed: [.hours, .minutes],
                width: .abbreviated,
                zeroValueUnits: .hide
            ).locale(locale)
        )
    }

    /// A row's share of the total, from 0 to 1.
    ///
    /// Zero rather than a division by zero when nothing is tracked. Not a
    /// defensive fallback: with a total of zero every row's share genuinely *is*
    /// zero, and there are no rows anyway.
    private static func share(of minutes: UInt32, in total: UInt32) -> Double {
        guard total > 0 else { return 0 }
        return Double(minutes) / Double(total)
    }
}

/// One task's tracked time.
public struct TimeReportRow: Sendable, Equatable, Identifiable {
    public let taskId: TaskId
    public let title: String

    /// Whole minutes tracked against the task, in the report's scope.
    public let minutes: UInt32

    /// How much of the report's total this row is, from 0 to 1.
    ///
    /// Carried rather than computed in the view so the bar and the number come
    /// from one pass: a bar drawn against a total the view recomputed could
    /// disagree with the total printed above it.
    public let share: Double

    public var id: TaskId { taskId }

    /// The duration, spelled.
    public func text(locale: Locale = .autoupdatingCurrent) -> String {
        TimeReport.text(minutes: minutes, locale: locale)
    }
}
