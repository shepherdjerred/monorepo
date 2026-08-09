internal import SwiftUI
internal import TaskNotesKit
internal import TaskNotesUniFFI

internal import struct Foundation.Date

/// The pomodoro window.
///
/// ## What was translated, and what was left behind
///
/// `PomodoroScreen.tsx` is a timer, two or three buttons, and — when nothing is
/// running — a full-screen `FlatList` of every task, because a phone has one
/// column and no other way to choose one. On a Mac that list is a **pop-up
/// button**: it costs one line of the window instead of all of it, it stays
/// available *while the timer runs* (the phone hides it), and it does not make
/// the window change shape the moment you press Start.
///
/// The phone also has no way to express "focus or break" — it renders whichever
/// phase the server reports and offers no choice. Here it is a segmented
/// control, because the server-driven cycling that made the choice unnecessary
/// is exactly what this client does not have yet.
///
/// ## The window is a view of the timer, not its owner
///
/// The interval lives in ``PomodoroTimer``, beside the store, for the app's
/// lifetime. Closing this window therefore does not stop the clock, and
/// reopening it shows the interval still running — which is what anybody who has
/// ever closed a timer window by reflex expects, and what `@State` here could
/// not have given.
struct PomodoroView: View {
    let timer: PomodoroTimer
    let store: Result<TaskNotesStore, CoreError>

    /// The task the interval is against, kept across launches.
    ///
    /// `@SceneStorage` rather than `@State`, matching the inspector: a window
    /// reopens the way it was left. The id is the vault path, which is stable,
    /// and an id that no longer resolves simply selects nothing.
    @SceneStorage("red.sjer.tasknotes.pomodoro.taskId") private var storedTaskId = ""

    var body: some View {
        clock
            .padding(24)
            // A fixed width and a height that hugs its content, because the
            // scene is `.windowResizability(.contentSize)`: a greedy frame here
            // would stretch to whatever `defaultSize` said and leave a band of
            // grey under the task picker.
            .frame(width: 292)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier(AccessibilityIdentifier.Timing.pomodoro)
            .onAppear { restoreSubject() }
    }

    /// The window, redrawn once a second only while something is running.
    ///
    /// `TimelineView(.periodic)` rather than a `Timer` publisher: SwiftUI owns
    /// the schedule, pauses it when the window is occluded, and tears it down
    /// with the view — three things a hand-held timer gets wrong in three
    /// different ways. The static branch matters just as much: an idle window
    /// redrawing once a second forever would keep waking the machine for a
    /// number that is not changing.
    ///
    /// The *controls* are inside the timeline as well as the dial, and that is
    /// not incidental: the moment an interval reaches zero the buttons have to
    /// change, and a control tree outside the schedule would still be offering
    /// **Pause** on a finished timer.
    @ViewBuilder
    private var clock: some View {
        if timer.session.isRunning {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                content(at: context.date)
            }
        } else {
            content(at: timer.now())
        }
    }

    private func content(at now: Date) -> some View {
        VStack(spacing: 18) {
            dial(at: now)
            controls(at: now)
            phasePicker
            subject
            footnote
                .padding(.top, 4)
        }
    }

    // ── The dial ───────────────────────────────────────────────────────────

    private func dial(at now: Date) -> some View {
        ZStack {
            Circle()
                .stroke(.quaternary, lineWidth: 10)
            Circle()
                .trim(from: 0, to: progress(at: now))
                .stroke(dialTint, style: StrokeStyle(lineWidth: 10, lineCap: .round))
                .rotationEffect(.degrees(-90))
            VStack(spacing: 2) {
                Text(display(at: now))
                    // Monospaced digits, or the whole dial jiggles once a second
                    // as the glyph widths change underneath it.
                    .font(.system(size: 44, weight: .medium, design: .rounded).monospacedDigit())
                    .accessibilityIdentifier(AccessibilityIdentifier.Timing.countdown)
                    .accessibilityLabel(spoken(at: now))
                // The caption says *done* rather than repeating the phase when
                // the interval has run out. A full ring over "Focus" and
                // "00:00" is three ways of saying the same thing and none of
                // them says it is over.
                Text(hasFinished(at: now) ? "\(phaseTitle) done" : phaseTitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            }
        }
        .frame(width: 180, height: 180)
    }

    /// The ring's colour.
    ///
    /// ⚠️ **Never red as time runs out.** Red means *late* everywhere in this
    /// app and nowhere else — an overdue date, and that is the whole list. A
    /// timer counting down is not late, it is working. So a focus interval draws
    /// in the accent tint and a break in a hierarchical grey, which is the same
    /// "one channel, one meaning" rule the task row's priority ramp follows.
    private var dialTint: AnyShapeStyle {
        switch timer.session.phase {
        case .work: AnyShapeStyle(.tint)
        case .`break`: AnyShapeStyle(.secondary)
        }
    }

    private var phaseTitle: String {
        switch timer.session.phase {
        case .work: "Focus"
        case .`break`: "Break"
        }
    }

    private var nextPhaseTitle: String {
        switch timer.session.phase {
        case .work: "Break"
        case .`break`: "Focus"
        }
    }

    // ── The controls ───────────────────────────────────────────────────────

    /// One verb, plus Stop.
    ///
    /// ## Two buttons, not three — and that is a fix, not a shortcut
    ///
    /// The first version put Start, Pause and Stop side by side and greyed out
    /// whichever did not apply, reading the plan's **disabled, never hidden**
    /// rule as applying here. Rendering it showed two things wrong with that.
    /// The three large buttons do not fit the window's width, so "Resume" came
    /// out as `Resu…` — and *that* rule is about the **menu bar**, where an item
    /// vanishing hides where a command lives. A window's primary control is the
    /// opposite case: Start and Pause are the same control in two states, and
    /// every timer on this platform draws them as one button whose verb changes
    /// — the Clock app, QuickTime, Music. Nothing is hidden, because nothing is
    /// missing: the button is right there, saying what it will do next.
    ///
    /// Stop stays beside it, present and dim while nothing is running, because
    /// it genuinely is a second command rather than the same one in another
    /// state.
    private func controls(at now: Date) -> some View {
        let primary = primaryAction(at: now)
        return HStack(spacing: 10) {
            Button(primary.title, systemImage: primary.symbol, action: primary.run)
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .accessibilityIdentifier(AccessibilityIdentifier.Timing.primary)
            Button("Stop", systemImage: "stop.fill") { timer.stop() }
                .buttonStyle(.bordered)
                .disabled(timer.session.isIdle)
                .accessibilityIdentifier(AccessibilityIdentifier.Timing.stop)
        }
        .controlSize(.large)
    }

    /// What the primary button says and does, given the interval's state.
    private func primaryAction(at now: Date) -> PomodoroAction {
        if hasFinished(at: now) {
            return PomodoroAction(
                title: "Start \(nextPhaseTitle)", symbol: "forward.fill", run: advance)
        }
        if timer.session.isRunning {
            return PomodoroAction(title: "Pause", symbol: "pause.fill", run: timer.pause)
        }
        return PomodoroAction(
            title: timer.session.isPaused ? "Resume" : "Start",
            symbol: "play.fill",
            run: start
        )
    }

    /// Focus or break, chosen rather than cycled to.
    ///
    /// Disabled once an interval has begun: changing the phase mid-interval
    /// would silently change how long the interval is, which is not what anyone
    /// asked for by clicking a segment. The obvious pairing is offered by the
    /// finished-interval button instead.
    private var phasePicker: some View {
        Picker("Interval", selection: phaseBinding) {
            Text("Focus").tag(PomodoroPhase.work)
            Text("Break").tag(PomodoroPhase.`break`)
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .disabled(!timer.session.isIdle)
        .frame(width: 200)
        .accessibilityIdentifier(AccessibilityIdentifier.Timing.phase)
        .accessibilityLabel("Interval type")
    }

    private func start() {
        if timer.session.isPaused {
            timer.resume()
        } else {
            timer.start(phase: timer.session.phase, taskId: selectedTaskId)
        }
    }

    /// Set up the interval that follows and start it.
    ///
    /// Two calls rather than one, because ``PomodoroTimer/advance()`` only
    /// *names* the next interval — the core has no say in what follows what, so
    /// nothing here may cycle on its own. This is a button press, which is a
    /// person deciding.
    private func advance() {
        timer.advance()
        timer.start(phase: timer.session.phase, taskId: selectedTaskId)
    }

    // ── What it is against ─────────────────────────────────────────────────

    /// The task the interval is being tracked against.
    ///
    /// A pop-up rather than the phone's full-screen list. "No task" is a real
    /// option and the default: a break is not against anything, and neither is
    /// twenty-five minutes of reading.
    @ViewBuilder
    private var subject: some View {
        switch store {
        case .success(let store):
            Picker("Task", selection: taskBinding) {
                Text("No task").tag(TaskId?.none)
                ForEach(candidates(in: store), id: \.id) { task in
                    Text(task.title).tag(TaskId?.some(task.id))
                }
            }
            .frame(maxWidth: 320)
            .accessibilityIdentifier(AccessibilityIdentifier.Timing.subject)
        case .failure(let error):
            Text(error.userMessage)
                .font(.caption)
                .foregroundStyle(.orange)
        }
    }

    /// Which tasks are worth offering.
    ///
    /// Open ones only, and the core decides which those are —
    /// `taskStatusIsActive` is the same predicate every list screen filters on,
    /// so a task finished on Today is not offered here either.
    private func candidates(in store: TaskNotesStore) -> [CoreTask] {
        store.tasks.filter { taskStatusIsActive(status: $0.status) }
    }

    // ── The honest footnote ────────────────────────────────────────────────

    /// What this timer does not do, said in the window rather than only in a
    /// comment.
    ///
    /// Deliberately plain and deliberately not orange: the tone scale in this
    /// app is *how much of this is yours to fix*, and there is nothing here for
    /// the reader to fix. It is a statement of scope, so it is drawn like one.
    @ViewBuilder
    private var footnote: some View {
        if let error = timer.lastError {
            Label(error.userMessage, systemImage: "exclamationmark.triangle.fill")
                .font(.caption)
                .foregroundStyle(.orange)
        } else {
            Text("Runs on this Mac. Time is not recorded against the task yet.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    // ── Bindings and derivation ────────────────────────────────────────────

    /// Choosing a phase sets one up; it does not start it.
    ///
    /// The effect a reader expects from clicking "Break" is a five-minute break
    /// *ready*, not one already counting down.
    private var phaseBinding: Binding<PomodoroPhase> {
        Binding(
            get: { timer.session.phase },
            set: { phase in timer.select(phase: phase) }
        )
    }

    private var taskBinding: Binding<TaskId?> {
        Binding(
            get: { selectedTaskId },
            set: { id in
                storedTaskId = id ?? ""
                timer.retarget(to: id)
            }
        )
    }

    private var selectedTaskId: TaskId? {
        if let running = timer.session.taskId { return running }
        return storedTaskId.isEmpty ? nil : storedTaskId
    }

    /// Re-point an idle timer at the restored task when the window opens.
    private func restoreSubject() {
        guard timer.session.isIdle, timer.session.taskId == nil, !storedTaskId.isEmpty else {
            return
        }
        timer.retarget(to: storedTaskId)
    }

    private func display(at now: Date) -> String {
        switch CoreErrors.capturing({ () throws(CoreError) -> String in
            try timer.session.display(at: now)
        }) {
        case .success(let text): return text
        // The failure is already held in `timer.lastError` and drawn in the
        // footnote; the dial shows a stopped clock rather than a blank.
        case .failure: return elapsedFormat(seconds: 0)
        }
    }

    private func progress(at now: Date) -> Double {
        switch CoreErrors.capturing({ () throws(CoreError) -> Double in
            try timer.session.progress(at: now)
        }) {
        case .success(let value): return value
        case .failure: return 0
        }
    }

    private func hasFinished(at now: Date) -> Bool {
        switch CoreErrors.capturing({ () throws(CoreError) -> Bool in
            try timer.session.hasFinished(at: now)
        }) {
        case .success(let finished): return finished
        case .failure: return false
        }
    }

    private func spoken(at now: Date) -> String {
        "\(display(at: now)) remaining in this \(phaseTitle.lowercased()) interval"
    }
}

/// What the pomodoro window's primary button says and does right now.
///
/// A value rather than three branches inside the view body, so the title, the
/// glyph and the action cannot drift apart — a button labelled "Pause" that
/// called `start()` is exactly the kind of mistake a `switch` returning only a
/// string invites.
private struct PomodoroAction {
    let title: String
    let symbol: String
    let run: () -> Void
}
