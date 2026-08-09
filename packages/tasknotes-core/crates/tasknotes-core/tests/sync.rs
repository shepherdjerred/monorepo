//! The shared sync corpus and the generated-sequence laws, over one harness.
//!
//! Both suites live in a single integration-test target on purpose: they share
//! the fake server, the injected capabilities and the world builder, and a
//! second target would compile a second copy of all of it — with every helper
//! either suite did not happen to use reported as dead code.
//!
//! ## The shared corpus
//!
//! The shared sync-scenario corpus, run against the Rust core.
//!
//! `packages/tasknotes-fixtures/scenarios/` is the **anti-drift mechanism**
//! between this crate and the TypeScript client in
//! `packages/tasks-for-obsidian`: both run these exact files, and both must
//! produce identical results. A scenario that passes in one implementation and
//! fails in the other is the bug the shared core exists to make impossible.
//!
//! The corpus holds twenty-five scenarios. One further case — "concurrent
//! `syncNow` calls coalesce" — asserts promise *reference identity* and is
//! deliberately TypeScript-only; its portable half is covered here by
//! `reconnect-delivers-each-mutation-once`.
//!
//! ## The generated-sequence laws
//!
//! Generated-sequence coverage of the merge and convergence laws.
//!
//! The scenario corpus pins the cases a human thought to write down. This file
//! covers the ones nobody would: a generated interleaving of mutations, network
//! transitions, concurrent Obsidian edits and crashes, checked against
//! properties that must hold no matter what order they land in. That is the
//! shape of the bug this whole architecture exists to prevent — "offline,
//! mutate, reconnect, receive a concurrent edit" — and a hand-written test can
//! only ever sample it.
//!
//! Four laws, checked after **every** transition:
//!
//! 1. **The view is derived.** `snapshot().tasks == rebase(base, pending)`,
//!    always. If those two ever disagree, some code path patched the
//!    projection instead of recomputing it, which is where an optimistic
//!    update and a server ack silently diverge.
//! 2. **Command ids are unique.** Across the queue *and* the dead-letter list.
//!    The id is the server's idempotency key; two commands sharing one would
//!    make the server replay the wrong response.
//! 3. **At most one application per mutation id.** Directly the exactly-once
//!    guarantee: however many times a command is re-sent — across retries,
//!    across crashes — the server may apply it once.
//!
//! Plus one law at teardown: **convergence**. Reconnect, drain to quiescence,
//! and the client's visible world must equal the server's.

#[cfg(test)]
mod support;

#[cfg(test)]
mod corpus {
    use super::support::{load_scenarios, runner};

    #[test]
    fn every_scenario_in_the_shared_corpus_passes() {
        let scenarios = load_scenarios();
        assert!(
            !scenarios.is_empty(),
            "the fixture corpus is empty — a vacuous pass is worse than a red test"
        );

        let mut failures = Vec::new();
        for scenario in &scenarios {
            if let Err(reason) = runner::run(scenario) {
                failures.push(format!(
                    "\n── {} ──\n  {} › {}\n  {}\n  {}",
                    scenario.id,
                    scenario.describe,
                    scenario.name,
                    scenario.doc.as_deref().unwrap_or("(no note)"),
                    reason
                ));
            }
        }

        assert!(
            failures.is_empty(),
            "{} of {} shared scenarios failed:{}",
            failures.len(),
            scenarios.len(),
            failures.join("")
        );
    }

    #[test]
    fn every_scenario_names_the_typescript_test_it_came_from() {
        for scenario in load_scenarios() {
            assert!(
                scenario.source.starts_with("src/data/sync/__tests__/"),
                "{} has an unexpected provenance: {}",
                scenario.id,
                scenario.source
            );
        }
    }
}

#[cfg(test)]
mod properties {
    use std::{
        collections::{BTreeMap, BTreeSet},
        sync::Arc,
    };

    use proptest::prelude::*;
    use proptest_state_machine::{ReferenceStateMachine, StateMachineTest, prop_state_machine};
    use tasknotes_core::{
        Error,
        domain::{CreateTaskRequest, Task, TaskId, TaskStatus, TaskTitle, UpdateTaskRequest},
        sync::{Command, CommandInput, rebase},
    };

    use super::support::{
        fake_server::{FakeServer, MutationMethod},
        harness::{DEFAULT_CLOCK_MS, ManualClock, MemoryCacheStorage, MemoryQueueStorage},
        runner::{World, build_world},
    };

    /// How many drain attempts teardown gives the engine before deciding it is
    /// stuck. A drain makes progress on every command — ack, or park — so a
    /// handful of passes is generous.
    const QUIESCENCE_ATTEMPTS: u8 = 64;

    /// The reference model.
    ///
    /// Deliberately thin: it tracks only what the *generator* needs to produce
    /// sensible sequences. Mirroring the sync algebra here would mean writing
    /// the implementation twice and checking one copy against the other, which
    /// proves only that the two copies agree.
    #[derive(Clone, Debug)]
    struct Model {
        online: bool,
        dispatched: usize,
    }

    /// One step in a generated sequence.
    #[derive(Clone, Debug)]
    enum Transition {
        /// The user creates a task.
        Create(u8),
        /// The user renames the nth visible task.
        Rename(u8, u8),
        /// The user sets the nth visible task's status.
        SetStatus(u8, bool),
        /// The user deletes the nth visible task.
        Delete(u8),
        /// The user completes an occurrence of the nth visible task.
        CompleteInstance(u8, u8),
        /// A concurrent Obsidian edit lands on the nth server task.
        ObsidianEdit(u8, u8),
        /// The server rejects, loses or refuses the next call to one method.
        InjectFailure(u8),
        /// The user taps Retry on the nth parked command.
        RetryDeadLetter(u8),
        /// The network drops.
        GoOffline,
        /// The network returns.
        GoOnline,
        /// A sync pass.
        Sync,
        /// The app is killed and relaunched from durable state alone.
        Relaunch,
    }

    impl ReferenceStateMachine for Model {
        type State = Self;
        type Transition = Transition;

        fn init_state() -> BoxedStrategy<Self::State> {
            Just(Self {
                online: true,
                dispatched: 0,
            })
            .boxed()
        }

        fn transitions(_state: &Self::State) -> BoxedStrategy<Self::Transition> {
            // Weighted so most steps are mutations: the interesting states are
            // the ones with a deep queue, and a sequence that is half network
            // transitions never builds one.
            prop_oneof![
                4 => any::<u8>().prop_map(Transition::Create),
                4 => (any::<u8>(), any::<u8>()).prop_map(|(slot, name)| Transition::Rename(slot, name)),
                4 => (any::<u8>(), any::<bool>()).prop_map(|(slot, done)| Transition::SetStatus(slot, done)),
                2 => any::<u8>().prop_map(Transition::Delete),
                3 => (any::<u8>(), any::<u8>()).prop_map(|(slot, day)| Transition::CompleteInstance(slot, day)),
                3 => (any::<u8>(), any::<u8>()).prop_map(|(slot, name)| Transition::ObsidianEdit(slot, name)),
                3 => any::<u8>().prop_map(Transition::InjectFailure),
                2 => any::<u8>().prop_map(Transition::RetryDeadLetter),
                2 => Just(Transition::GoOffline),
                2 => Just(Transition::GoOnline),
                5 => Just(Transition::Sync),
                1 => Just(Transition::Relaunch),
            ]
            .boxed()
        }

        fn apply(mut state: Self::State, transition: &Self::Transition) -> Self::State {
            match *transition {
                Transition::GoOffline => state.online = false,
                Transition::GoOnline => state.online = true,
                Transition::Create(_)
                | Transition::Rename(_, _)
                | Transition::SetStatus(_, _)
                | Transition::Delete(_)
                | Transition::CompleteInstance(_, _) => {
                    state.dispatched = state.dispatched.saturating_add(1);
                }
                Transition::ObsidianEdit(_, _)
                | Transition::InjectFailure(_)
                | Transition::RetryDeadLetter(_)
                | Transition::Sync
                | Transition::Relaunch => {}
            }
            state
        }
    }

    /// The system under test: a whole client plus the server it talks to.
    struct Sut {
        world: World,
    }

    fn fresh_world() -> World {
        let clock = Arc::new(ManualClock::new(DEFAULT_CLOCK_MS));
        let server = Arc::new(FakeServer::new(Arc::clone(&clock)));
        build_world(
            clock,
            server,
            Arc::new(MemoryQueueStorage::default()),
            Arc::new(MemoryCacheStorage::default()),
            false,
        )
    }

    /// Pick the nth visible task, wrapping. `None` when the list is empty.
    fn nth_visible(world: &World, slot: u8) -> Option<TaskId> {
        let tasks = &world.engine.store().snapshot().tasks;
        if tasks.is_empty() {
            return None;
        }
        let index = usize::from(slot) % tasks.len();
        tasks.keys().nth(index).cloned()
    }

    /// Pick the nth server task, wrapping. `None` when the vault is empty.
    fn nth_server(world: &World, slot: u8) -> Option<TaskId> {
        let tasks = world.server.tasks();
        if tasks.is_empty() {
            return None;
        }
        let index = usize::from(slot) % tasks.len();
        tasks.keys().nth(index).cloned()
    }

    fn title(seed: u8) -> TaskTitle {
        TaskTitle::parse(format!("Task {seed}")).expect("a non-empty title")
    }

    /// One failure per class the classifier distinguishes, so a generated
    /// sequence reaches the dead-letter, auth-stop and 404-on-delete paths as
    /// well as the happy one.
    fn injected_failure(seed: u8) -> (MutationMethod, Error) {
        match seed % 6 {
            0 => (MutationMethod::UpdateTask, Error::api("invalid", 422)),
            1 => (
                MutationMethod::UpdateTask,
                Error::not_found("Task", "Tasks/gone.md"),
            ),
            2 => (MutationMethod::CreateTask, Error::api("boom", 500)),
            3 => (
                MutationMethod::ToggleTaskStatus,
                Error::api("unauthorized", 401),
            ),
            4 => (
                MutationMethod::DeleteTask,
                Error::not_found("Task", "Tasks/gone.md"),
            ),
            _ => (
                MutationMethod::CompleteRecurringInstance,
                Error::network("flaky"),
            ),
        }
    }

    fn day(seed: u8) -> String {
        format!("2026-07-{:02}", (u32::from(seed) % 28) + 1)
    }

    impl Sut {
        fn dispatch(&mut self, input: CommandInput) {
            self.world
                .engine
                .dispatch(input)
                .expect("the in-memory storage cannot fail");
        }

        /// Reconnect and drain until nothing is left to send.
        fn quiesce(&mut self) {
            self.world.server.go_online();
            for _ in 0..QUIESCENCE_ATTEMPTS {
                if self.world.engine.store().queue().is_empty() {
                    // One more pass so the base reflects the final server
                    // state even when the last command was acked long ago.
                    drop(self.world.engine.sync_now());
                    return;
                }
                drop(self.world.engine.sync_now());
            }
        }
    }

    impl StateMachineTest for Sut {
        type SystemUnderTest = Self;
        type Reference = Model;

        fn init_test(_ref_state: &Model) -> Self::SystemUnderTest {
            let mut world = fresh_world();
            world
                .engine
                .restore()
                .expect("restoring empty storage cannot fail");
            Self { world }
        }

        fn apply(
            mut state: Self::SystemUnderTest,
            _ref_state: &Model,
            transition: Transition,
        ) -> Self::SystemUnderTest {
            match transition {
                Transition::Create(seed) => state.dispatch(CommandInput::Create {
                    payload: CreateTaskRequest::new(title(seed)),
                }),
                Transition::Rename(slot, seed) => {
                    if let Some(task_id) = nth_visible(&state.world, slot) {
                        state.dispatch(CommandInput::Update {
                            task_id,
                            payload: UpdateTaskRequest {
                                title: Some(title(seed)),
                                ..UpdateTaskRequest::default()
                            },
                        });
                    }
                }
                Transition::SetStatus(slot, done) => {
                    if let Some(task_id) = nth_visible(&state.world, slot) {
                        state.dispatch(CommandInput::SetStatus {
                            task_id,
                            status: if done {
                                TaskStatus::Done
                            } else {
                                TaskStatus::Open
                            },
                        });
                    }
                }
                Transition::Delete(slot) => {
                    if let Some(task_id) = nth_visible(&state.world, slot) {
                        state.dispatch(CommandInput::Delete { task_id });
                    }
                }
                Transition::CompleteInstance(slot, seed) => {
                    if let Some(task_id) = nth_visible(&state.world, slot) {
                        state.dispatch(CommandInput::SetInstanceComplete {
                            task_id,
                            date: day(seed),
                            completed: true,
                        });
                    }
                }
                Transition::ObsidianEdit(slot, seed) => {
                    if let Some(task_id) = nth_server(&state.world, slot) {
                        let new_title = format!("Obsidian {seed}");
                        state
                            .world
                            .server
                            .inject_server_edit(&task_id, |task| task.title = new_title)
                            .expect("the id came from the server's own map");
                    }
                }
                Transition::InjectFailure(seed) => {
                    let (method, error) = injected_failure(seed);
                    state.world.server.fail_next(method, error);
                }
                Transition::RetryDeadLetter(slot) => {
                    let parked = state.world.engine.store().snapshot().dead_letters.clone();
                    if !parked.is_empty() {
                        let index = usize::from(slot) % parked.len();
                        if let Some(entry) = parked.get(index) {
                            state
                                .world
                                .engine
                                .retry_dead_letter(entry.command.id())
                                .expect("the in-memory storage cannot fail");
                        }
                    }
                }
                Transition::GoOffline => state.world.server.go_offline(),
                Transition::GoOnline => state.world.server.go_online(),
                Transition::Sync => drop(state.world.engine.sync_now()),
                Transition::Relaunch => {
                    // Only the durable half survives. The clock and the server
                    // do — the server is what remembers which mutation ids it
                    // already applied.
                    let mut world = build_world(
                        Arc::clone(&state.world.clock),
                        Arc::clone(&state.world.server),
                        Arc::new(state.world.queue_storage.snapshot()),
                        Arc::new(state.world.cache_storage.snapshot()),
                        false,
                    );
                    world
                        .engine
                        .restore()
                        .expect("the in-memory storage cannot fail");
                    state.world = world;
                }
            }
            state
        }

        fn check_invariants(state: &Self::SystemUnderTest, _ref_state: &Model) {
            let store = state.world.engine.store();

            // 1. The view is derived, never patched.
            let expected = rebase(store.base(), store.queue().pending());
            assert_eq!(
                store.snapshot().tasks,
                expected,
                "the visible view drifted from rebase(base, pending)"
            );

            // 2. Command ids are unique across the queue and the parked list.
            let mut seen = BTreeSet::new();
            for command in store.queue().pending() {
                assert!(
                    seen.insert(command.id().to_owned()),
                    "duplicate command id {} in the queue",
                    command.id()
                );
            }
            for entry in store.queue().dead_letters() {
                assert!(
                    seen.insert(entry.command.id().to_owned()),
                    "command id {} is both queued and parked",
                    entry.command.id()
                );
            }

            // 3. At most one application per mutation id — exactly-once,
            //    across retries and across crashes alike.
            let mut applied: BTreeMap<String, usize> = BTreeMap::new();
            for call in state.world.server.calls() {
                if !call.applied {
                    continue;
                }
                if let Some(ref mutation_id) = call.mutation_id {
                    let count = applied.entry(mutation_id.clone()).or_default();
                    *count = count.saturating_add(1);
                    assert_eq!(
                        *count, 1,
                        "mutation {mutation_id} was applied more than once"
                    );
                }
            }
        }

        fn teardown(mut state: Self::SystemUnderTest, _ref_state: Model) {
            state.quiesce();

            let store = state.world.engine.store();
            assert!(
                store.queue().is_empty(),
                "the queue did not drain: {:?}",
                store.queue().pending()
            );

            // Convergence: with nothing pending, the client's world *is* the
            // server's world.
            let visible = store.snapshot().tasks.clone();
            let server = state.world.server.tasks();
            let visible_ids: BTreeSet<&str> = visible.keys().map(TaskId::as_str).collect();
            let server_ids: BTreeSet<&str> = server.keys().map(TaskId::as_str).collect();
            assert_eq!(
                visible_ids, server_ids,
                "the client and the server disagree about which tasks exist"
            );
            for (id, task) in &visible {
                let counterpart = server.get(id).expect("the id sets already matched");
                assert_eq!(
                    describe(task),
                    describe(counterpart),
                    "task {id} differs between client and server"
                );
            }

            // No temp id outlives quiescence: every create either landed on a
            // real path or was parked, and nothing was parked here.
            for id in visible.keys() {
                assert!(!id.is_temp(), "a temp id survived convergence: {id}");
            }
        }
    }

    /// The fields convergence is about. Server-computed metadata (`dateModified`
    /// and friends) is excluded deliberately: the client never claims to
    /// predict it.
    fn describe(task: &Task) -> (String, TaskStatus, Vec<String>) {
        (
            task.title.clone(),
            task.status,
            task.complete_instances.clone(),
        )
    }

    /// A sanity check that the machine is exercising something: a create
    /// dispatched offline must survive a relaunch and land exactly once.
    #[test]
    fn a_generated_sequence_is_not_vacuous() {
        let mut sut = Sut::init_test(&Model {
            online: true,
            dispatched: 0,
        });
        sut.world.server.go_offline();
        sut = Sut::apply(
            sut,
            &Model {
                online: false,
                dispatched: 1,
            },
            Transition::Create(1),
        );
        sut = Sut::apply(
            sut,
            &Model {
                online: false,
                dispatched: 1,
            },
            Transition::Sync,
        );
        sut = Sut::apply(
            sut,
            &Model {
                online: false,
                dispatched: 1,
            },
            Transition::Relaunch,
        );
        assert_eq!(
            sut.world.engine.store().queue().pending().len(),
            1,
            "the offline create must survive the relaunch"
        );
        assert!(matches!(
            sut.world.engine.store().queue().head(),
            Some(&Command::Create { .. })
        ));
        Sut::teardown(
            sut,
            Model {
                online: true,
                dispatched: 1,
            },
        );
    }

    prop_state_machine! {
        #![proptest_config(ProptestConfig {
            // Enough sequences to reach a deep queue crossed with a crash,
            // without making the suite a bottleneck on every PR.
            cases: 96,
            .. ProptestConfig::default()
        })]

        /// Every law above, over generated interleavings of up to twenty steps.
        #[test]
        fn the_sync_stack_converges_under_any_interleaving(
            sequential 1..20 => Sut
        );
    }
}
