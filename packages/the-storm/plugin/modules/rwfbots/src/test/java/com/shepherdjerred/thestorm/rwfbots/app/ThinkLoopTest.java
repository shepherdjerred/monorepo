package com.shepherdjerred.thestorm.rwfbots.app;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.compute.ComputePool;
import com.shepherdjerred.thestorm.core.compute.DirectComputePool;
import com.shepherdjerred.thestorm.rwfbots.domain.Fixtures;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Quirk;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.record.DecisionTrace;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombOwner;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;
import org.junit.jupiter.api.Test;

/**
 * The think loop coalesces snapshots, thinks for the bots that are due, stamps decisions with the
 * life they were made for, respects the ray budget and the governor, and is deterministic.
 */
final class ThinkLoopTest {

  private static final NavArtifact NAV = SyntheticMap.bake();
  private static final CombatantId RED_1 = new CombatantId(1);
  private static final CombatantId RED_2 = new CombatantId(2);
  private static final CombatantId BLUE_1 = new CombatantId(3);
  private static final ThinkRates RATES = new ThinkRates(2, 5, 10, 40, 10_000);

  /** Runs nothing until told; counts how many jobs were handed over. */
  private static final class ManualPool implements ComputePool {
    final ArrayDeque<Runnable> queued = new ArrayDeque<>();
    int submitted;
    private final int workers;

    ManualPool() {
      this(1);
    }

    ManualPool(int workers) {
      this.workers = workers;
    }

    @Override
    public int parallelism() {
      return workers;
    }

    @Override
    public Executor executor() {
      return task -> {
        submitted++;
        queued.add(task);
      };
    }

    void runAll() {
      Runnable task;
      while ((task = queued.poll()) != null) {
        task.run();
      }
    }

    @Override
    public void close() {}
  }

  /** A pool over a real single thread, for the concurrent cases. */
  private static final class ThreadPool implements ComputePool {
    final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override
    public Executor executor() {
      return executor;
    }

    @Override
    public void close() {
      executor.shutdownNow();
    }
  }

  private static final class CountingTraces implements TraceSink {
    final List<DecisionTrace> traces = new ArrayList<>();

    @Override
    public synchronized void record(DecisionTrace trace, Decision decision) {
      traces.add(trace);
    }

    synchronized int count() {
      return traces.size();
    }
  }

  private static Governor governor() {
    return new Governor(new Governor.Settings(40, 47, 6, 35, 4, 3, 48, 2));
  }

  private static ThinkLoop loop(ComputePool pool, Governor governor, TraceSink traces) {
    var clock = new AtomicLong();
    return new ThinkLoop(
        new ThinkLoop.Parts(pool, RATES, governor, traces, () -> clock.addAndGet(1_000_000)));
  }

  private static BotProfile profile(CombatantId id, int slot) {
    return profile(id, slot, RED);
  }

  private static BotProfile profile(CombatantId id, int slot, TeamId team) {
    return new BotProfile(
        id,
        slot,
        "bot-" + id.value(),
        team,
        Kit.TROOPER,
        Fixtures.levers(0.7),
        new Style(0.5, 0.5, 0.6, 0.5),
        Map.of(Role.PLANT, 1.0, Role.ESCORT, 0.8),
        Archetype.TACTICIAN,
        Set.of(Quirk.ALWAYS_GG));
  }

  private static WorldSnapshot snapshot(long tick) {
    return new WorldSnapshot(
        tick,
        MatchPhase.LIVE,
        List.of(
            Fixtures.combatant(1, RED, SyntheticMap.RED_SPAWN.feet()),
            Fixtures.combatant(2, RED, SyntheticMap.RED_SPAWN.offset(1, 0, 1).feet()),
            Fixtures.combatant(3, BLUE, SyntheticMap.RED_SPAWN.offset(0, 0, 4).feet())),
        List.of(
            new BombView(
                new BombId(0),
                new BombOwner.Team(RED),
                SyntheticMap.RED_BOMB.center(),
                new BombState.Idle()),
            new BombView(
                new BombId(1),
                new BombOwner.Team(BLUE),
                SyntheticMap.BLUE_BOMB.center(),
                new BombState.Idle())),
        PoisonView.NONE,
        NAV.mapId(),
        List.of(),
        List.of(), List.of());
  }

  private static void register(ThinkLoop loop) {
    loop.beginMatch(42, NAV);
    loop.register(profile(RED_1, 0));
    loop.register(profile(RED_2, 1));
  }

  @Test
  void aDoorObservationKeepsRegisteredBodiesAndLifeEpochs() {
    var loop = loop(new DirectComputePool(), governor(), TraceSink.none());
    register(loop);
    loop.publish(snapshot(1));
    var next =
        NAV.withGrid(
            NAV.grid()
                .withDoorState(
                    new com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos(3, 1, 3), false));
    loop.observedNavigation(next);
    loop.publish(snapshot(2));
    assertThat(loop.board().tick()).isEqualTo(2);
    assertThat(loop.board().thoughts()).containsOnlyKeys(RED_1, RED_2);
    assertThat(loop.board().of(RED_1).orElseThrow().decision().lifeEpoch()).isZero();
    loop.close();
  }

  @Test
  void aJobThinksForEveryRegisteredBotAndPublishesTheBoard() {
    var traces = new CountingTraces();
    var loop = loop(new DirectComputePool(), governor(), traces);
    register(loop);

    loop.publish(snapshot(1));

    var board = loop.board();
    assertThat(board.tick()).isEqualTo(1);
    assertThat(board.thoughts()).containsOnlyKeys(RED_1, RED_2);
    assertThat(board.of(RED_1).orElseThrow().decision().snapshotTick()).isEqualTo(1);
    assertThat(board.of(RED_1).orElseThrow().decision().lifeEpoch()).isZero();
    assertThat(board.of(RED_1).orElseThrow().percept().visible())
        .extracting(v -> v.id())
        .containsExactly(BLUE_1);
    assertThat(board.perceived()).isEqualTo(2);
    assertThat(board.thought()).isEqualTo(2);
    assertThat(traces.count()).isEqualTo(2);
    assertThat(loop.busy()).isFalse();
    assertThat(loop.stats().count()).isEqualTo(1);
  }

  @Test
  void snapshotsPublishedWhileAJobWaitsCoalesceIntoTheNewest() {
    var pool = new ManualPool();
    var loop = loop(pool, governor(), TraceSink.none());
    register(loop);

    loop.publish(snapshot(1));
    loop.publish(snapshot(2));
    loop.publish(snapshot(3));
    assertThat(pool.submitted).isEqualTo(1);
    assertThat(loop.busy()).isTrue();

    pool.runAll();

    assertThat(loop.board().tick()).isEqualTo(3);
    assertThat(loop.busy()).isFalse();
    loop.publish(snapshot(4));
    assertThat(pool.submitted).isEqualTo(2);
  }

  @Test
  void aSnapshotArrivingDuringAJobStartsAnotherJob() {
    var pool = new ManualPool();
    var loop = loop(pool, governor(), TraceSink.none());
    register(loop);
    loop.publish(snapshot(1));
    var first = pool.queued.poll();
    // The worker is "running" (flag set) when the main thread publishes again.
    loop.publish(snapshot(2));
    assertThat(pool.submitted).isEqualTo(1);

    first.run();

    // The job drained both snapshots itself; nothing is left and the newest won.
    assertThat(loop.board().tick()).isEqualTo(2);
    assertThat(pool.queued).isEmpty();
  }

  @Test
  void bumpingTheEpochRestartsTheBotsPlanInTheNewLife() {
    var loop = loop(new DirectComputePool(), governor(), TraceSink.none());
    register(loop);
    loop.publish(snapshot(1));
    var before = loop.board().of(RED_1).orElseThrow();

    loop.bumpEpoch(RED_1);
    loop.publish(snapshot(2));

    var after = loop.board().of(RED_1).orElseThrow();
    assertThat(before.lifeEpoch()).isZero();
    assertThat(after.lifeEpoch()).isEqualTo(1);
    assertThat(after.decision().lifeEpoch()).isEqualTo(1);
    assertThat(after.decision().snapshotTick()).isEqualTo(2);
    // The other bot was not due and kept its first decision.
    assertThat(loop.board().of(RED_2).orElseThrow().decision().snapshotTick()).isEqualTo(1);
  }

  @Test
  void staggeredBotsThinkOnDifferentTicksAndTheGovernorHalvesTheRate() {
    var calm = thoughtsOver(governor(), 20);
    var pressed = governor();
    for (var i = 0; i < 3; i++) {
      pressed.observe(new Governor.Sample(45, 1));
    }
    assertThat(pressed.level()).isEqualTo(1);
    var slowed = thoughtsOver(pressed, 20);

    // Two bots at 4 Hz over 20 ticks think about eight times; halved, about four.
    assertThat(calm).isBetween(8, 10);
    assertThat(slowed).isBetween(4, 6);
    assertThat(slowed).isLessThan(calm);
  }

  private static int thoughtsOver(Governor governor, int ticks) {
    var loop = loop(new DirectComputePool(), governor, TraceSink.none());
    register(loop);
    var thoughts = 0;
    var tactics = new ArrayList<Long>();
    for (var tick = 1; tick <= ticks; tick++) {
      loop.publish(snapshot(tick));
      thoughts += loop.board().thought();
      tactics.add(loop.board().of(RED_1).orElseThrow().decision().snapshotTick());
    }
    // RED_1 (slot 0) and RED_2 (slot 1) never rethink on the same tick after the first.
    var red2 = loop.board().of(RED_2).orElseThrow().decision().snapshotTick();
    assertThat(red2).isNotEqualTo(tactics.getLast());
    return thoughts;
  }

  @Test
  void theRayBudgetBoundsStartupAndServesTheOldestPerceptionFirst() {
    var tight = new ThinkRates(2, 5, 10, 40, 1);
    var clock = new AtomicLong();
    var loop =
        new ThinkLoop(
            new ThinkLoop.Parts(
                new DirectComputePool(),
                tight,
                governor(),
                TraceSink.none(),
                () -> clock.addAndGet(1000)));
    register(loop);

    loop.publish(snapshot(1));
    assertThat(loop.board().perceived()).isEqualTo(1);
    assertThat(loop.board().perceptions().get(RED_2)).isEqualTo(new PerceptionAge(1, true));
    loop.publish(snapshot(2));
    assertThat(loop.board().of(RED_2).orElseThrow().percept().tick()).isEqualTo(2);
    loop.publish(snapshot(3));

    assertThat(loop.board().perceived()).isEqualTo(1);
    assertThat(loop.board().of(RED_1).orElseThrow().percept().tick()).isEqualTo(3);
    loop.publish(snapshot(4));
    assertThat(loop.board().of(RED_2).orElseThrow().percept().tick()).isEqualTo(4);
    assertThat(loop.board().perceptions().values()).noneMatch(PerceptionAge::pending);
  }

  @Test
  void theSameSeedAndSnapshotsGiveTheSameDecisions() {
    var a = loop(new DirectComputePool(), governor(), TraceSink.none());
    var b = loop(new DirectComputePool(), governor(), TraceSink.none());
    register(a);
    register(b);
    for (var tick = 1; tick <= 30; tick++) {
      a.publish(snapshot(tick));
      b.publish(snapshot(tick));
    }
    assertThat(a.board().thoughts()).isEqualTo(b.board().thoughts());
  }

  @Test
  void parallelStagesMatchSerialDecisionsDespiteReversedTaskCompletion() {
    var serialTraces = new CountingTraces();
    var parallelTraces = new CountingTraces();
    var serial = loop(new DirectComputePool(), governor(), serialTraces);
    var pool = new ManualPool(4);
    var parallel = loop(pool, governor(), parallelTraces);
    serial.beginMatch(42, NAV);
    parallel.beginMatch(42, NAV);
    var roster = new ArrayList<CombatantView>();
    for (var bot = 0; bot < 12; bot++) {
      var team = bot % 2 == 0 ? RED : BLUE;
      var view = Fixtures.combatant(bot + 1, team, NAV.graph().feet(bot * 3));
      roster.add(view);
      serial.register(profile(view.id(), bot, team));
      parallel.register(profile(view.id(), bot, team));
    }
    for (var tick = 1; tick <= 80; tick++) {
      var original = snapshot(tick);
      var snapshot =
          new WorldSnapshot(
              tick,
              MatchPhase.LIVE,
              roster,
              original.bombs(),
              PoisonView.NONE,
              NAV.mapId(),
              List.of(),
              List.of(), List.of());
      serial.publish(snapshot);
      parallel.publish(snapshot);
      while (!pool.queued.isEmpty()) pool.queued.removeLast().run();
      assertThat(parallel.board().thoughts()).isEqualTo(serial.board().thoughts());
      assertThat(parallel.board().plans()).isEqualTo(serial.board().plans());
      assertThat(parallel.board().perceptions()).isEqualTo(serial.board().perceptions());
      assertThat(parallelTraces.traces).isEqualTo(serialTraces.traces);
    }
    assertThat(pool.submitted).isGreaterThan(80);
    serial.close();
    parallel.close();
  }

  @Test
  void anEpochChangeDuringParallelPerceptionDiscardsTheOldLife() {
    var pool = new ManualPool(4);
    var loop = loop(pool, governor(), TraceSink.none());
    register(loop);
    loop.publish(snapshot(1));
    pool.queued.removeFirst().run();
    assertThat(pool.queued).hasSize(2);
    loop.bumpEpoch(RED_1);
    pool.runAll();
    assertThat(loop.board().thoughts()).doesNotContainKey(RED_1);
    loop.publish(snapshot(2));
    pool.runAll();
    assertThat(loop.board().of(RED_1).orElseThrow().lifeEpoch()).isEqualTo(1);
  }

  @Test
  void aNewLifeKeepsThePreviousObservationAgeUntilFreshPerceptionCommits() {
    var pool = new ManualPool(4);
    var loop = loop(pool, governor(), TraceSink.none());
    register(loop);
    loop.publish(snapshot(1));
    pool.runAll();
    loop.publish(snapshot(3));
    pool.queued.removeFirst().run();
    loop.bumpEpoch(RED_1);
    pool.runAll();
    assertThat(loop.board().thoughts()).doesNotContainKey(RED_1);
    var previous = requireNonNull(loop.board().perceptions().get(RED_1));
    assertThat(previous).isEqualTo(new PerceptionAge(1, false));
    assertThat(previous.at(3)).isEqualTo(2);
    loop.publish(snapshot(4));
    pool.runAll();
    assertThat(loop.board().perceptions().get(RED_1)).isEqualTo(new PerceptionAge(4, false));
    assertThat(loop.board().of(RED_1).orElseThrow().lifeEpoch()).isEqualTo(1);
    loop.close();
  }

  @Test
  void endingAndRestartingDuringParallelWorkNeverPublishesTheRetiredBoard() {
    var pool = new ManualPool(4);
    var loop = loop(pool, governor(), TraceSink.none());
    register(loop);
    loop.publish(snapshot(1));
    pool.queued.removeFirst().run();
    loop.endMatch();
    register(loop);
    pool.runAll();
    assertThat(loop.board()).isEqualTo(DecisionBoard.EMPTY);
    loop.publish(snapshot(2));
    pool.runAll();
    assertThat(loop.board().tick()).isEqualTo(2);
  }

  @Test
  void endingAndRestartingDuringRoleDistancesNeverPublishesTheRetiredAssignment() {
    var pool = new ManualPool(4);
    var loop = loop(pool, governor(), TraceSink.none());
    register(loop);
    loop.publish(snapshot(1));
    advanceToRoleDistances(pool);
    loop.endMatch();
    register(loop);
    pool.runAll();
    assertThat(loop.board()).isEqualTo(DecisionBoard.EMPTY);
    loop.publish(snapshot(2));
    pool.runAll();
    assertThat(loop.board().tick()).isEqualTo(2);
    assertThat(requireNonNull(loop.board().plans().get(RED)).assignment())
        .containsOnlyKeys(RED_1, RED_2);
    loop.close();
  }

  @Test
  void navigationChangingDuringRoleDistancesDiscardsThePreparedAssignment() {
    var pool = new ManualPool(4);
    var loop = loop(pool, governor(), TraceSink.none());
    register(loop);
    loop.publish(snapshot(1));
    advanceToRoleDistances(pool);
    pool.queued.removeLast().run();
    loop.observedNavigation(NAV);
    pool.runAll();
    assertThat(loop.board()).isEqualTo(DecisionBoard.EMPTY);
    loop.publish(snapshot(2));
    pool.runAll();
    assertThat(loop.board().tick()).isEqualTo(2);
    assertThat(loop.board().perceived()).isEqualTo(2);
    loop.close();
  }

  private static void advanceToRoleDistances(ManualPool pool) {
    pool.queued.removeFirst().run(); // Cycle preparation queues two perception batches.
    assertThat(pool.queued).hasSize(2);
    pool.queued.removeFirst().run();
    pool.queued.removeFirst().run(); // Observation merge queues one team preparation batch.
    assertThat(pool.queued).hasSize(1);
    pool.queued.removeFirst().run(); // Team preparation queues the two distinct source rows.
    assertThat(pool.queued).hasSize(2);
  }

  @Test
  void navigationChangingDuringAStageDiscardsItsResultsAndForcesFreshPerception() {
    var pool = new ManualPool(4);
    var loop = loop(pool, governor(), TraceSink.none());
    register(loop);
    loop.publish(snapshot(1));
    pool.queued.removeFirst().run();
    loop.observedNavigation(NAV);
    pool.runAll();
    assertThat(loop.board()).isEqualTo(DecisionBoard.EMPTY);
    loop.publish(snapshot(2));
    pool.runAll();
    assertThat(loop.board().tick()).isEqualTo(2);
    assertThat(loop.board().perceived()).isEqualTo(2);
    assertThat(loop.board().of(RED_1).orElseThrow().percept().tick()).isEqualTo(2);
  }

  @Test
  void aWorkerFailureIsReportedAndTheNextMatchCanRecover() {
    var fail = new AtomicBoolean(true);
    var loop =
        loop(
            new DirectComputePool(),
            governor(),
            (trace, decision) -> {
              if (fail.getAndSet(false)) throw new IllegalStateException("broken trace contract");
            });
    register(loop);
    loop.publish(snapshot(1));
    assertThat(loop.board()).isEqualTo(DecisionBoard.EMPTY);
    assertThatThrownBy(() -> loop.publish(snapshot(2)))
        .isInstanceOf(IllegalStateException.class)
        .hasMessage("Bot thinking cycle failed");
    loop.publish(snapshot(3));
    assertThat(loop.board()).isEqualTo(DecisionBoard.EMPTY);
    loop.endMatch();
    register(loop);
    loop.publish(snapshot(4));
    assertThat(loop.board().tick()).isEqualTo(4);
  }

  @Test
  void aRetiredCyclesLateFailureDoesNotPoisonTheNextMatch() {
    var reference = new AtomicReference<ThinkLoop>();
    var fail = new AtomicBoolean(true);
    var loop =
        loop(
            new DirectComputePool(),
            governor(),
            (trace, decision) -> {
              if (!fail.getAndSet(false)) return;
              var current = reference.get();
              current.endMatch();
              register(current);
              throw new IllegalStateException("retired cycle failed after the next match began");
            });
    reference.set(loop);
    register(loop);
    loop.publish(snapshot(1));
    loop.publish(snapshot(2));
    assertThat(loop.board().tick()).isEqualTo(2);
    assertThat(loop.board().thoughts()).containsOnlyKeys(RED_1, RED_2);
    loop.close();
  }

  @Test
  void cycleLatencyIncludesTimeQueuedBeforeTheFirstWorkerRuns() {
    var pool = new ManualPool(4);
    var clock = new AtomicLong();
    var loop =
        new ThinkLoop(new ThinkLoop.Parts(pool, RATES, governor(), TraceSink.none(), clock::get));
    register(loop);
    loop.publish(snapshot(1));
    clock.set(60_000_000);
    pool.runAll();
    assertThat(loop.board().thinkNanos()).isEqualTo(60_000_000);
    assertThat(loop.stats().overruns()).isEqualTo(1);
  }

  @Test
  void aBudgeted256BotStartupHasNoStarvedSlotsAndReportsEveryWaitingBot() {
    var rates = new ThinkRates(2, 5, 10, 40, 96);
    var loop =
        new ThinkLoop(
            new ThinkLoop.Parts(
                new DirectComputePool(), rates, governor(), TraceSink.none(), () -> 0));
    loop.beginMatch(42, NAV);
    var views = new ArrayList<CombatantView>();
    for (var slot = 0; slot < 256; slot++) {
      var id = new CombatantId(slot + 1);
      loop.register(profile(id, slot));
      views.add(Fixtures.combatant(id.value(), RED, SyntheticMap.RED_SPAWN.feet()));
    }
    views.add(Fixtures.combatant(257, BLUE, SyntheticMap.RED_SPAWN.offset(0, 0, 4).feet()));
    var original = snapshot(1);
    for (var tick = 1; tick <= 16; tick++) {
      loop.publish(
          new WorldSnapshot(
              tick,
              original.matchPhase(),
              views,
              original.bombs(),
              original.poison(),
              original.mapId(),
              original.stimuli(),
              List.of(), List.of()));
      assertThat(loop.board().perceived()).isEqualTo(32);
      assertThat(loop.board().perceptions()).hasSize(256);
      if (tick >= 8) {
        assertThat(loop.board().perceptions().values()).noneMatch(PerceptionAge::pending);
        var now = tick;
        assertThat(loop.board().perceptions().values())
            .allSatisfy(age -> assertThat(age.at(now)).isLessThanOrEqualTo(7));
      }
    }
    assertThat(loop.board().thoughts()).hasSize(256);
    loop.close();
  }

  @Test
  void endingTheMatchClearsTheBoardAndIgnoresPublishes() {
    var pool = new ManualPool();
    var loop = loop(pool, governor(), TraceSink.none());
    register(loop);
    loop.publish(snapshot(1));
    pool.runAll();
    assertThat(loop.board().thoughts()).isNotEmpty();

    loop.endMatch();
    loop.publish(snapshot(2));

    assertThat(loop.board()).isEqualTo(DecisionBoard.EMPTY);
    assertThat(pool.queued).isEmpty();
    assertThat(loop.inMatch()).isFalse();
    assertThat(loop.profiles()).isEmpty();
  }

  @Test
  void aRealWorkerThreadKeepsUpWithABurstOfSnapshotsAndNeverRunsTwoJobsAtOnce() throws Exception {
    var pool = new ThreadPool();
    try {
      var loop = loop(pool, governor(), TraceSink.none());
      register(loop);
      for (var tick = 1; tick <= 200; tick++) {
        loop.publish(snapshot(tick));
      }
      await(() -> loop.board().tick() == 200 && !loop.busy());

      assertThat(loop.board().thoughts()).containsOnlyKeys(RED_1, RED_2);
      // Coalescing means fewer jobs than snapshots on any real machine, never more.
      assertThat(loop.stats().count()).isLessThanOrEqualTo(200);
      assertThat(loop.stats().percentileMillis(0.95)).isGreaterThan(0);
      loop.close();
      loop.publish(snapshot(201));
      assertThat(loop.board()).isEqualTo(DecisionBoard.EMPTY);
    } finally {
      pool.close();
      assertThat(pool.executor.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
    }
  }

  @Test
  void seedsMixTheBotAndTheTick() {
    assertThat(ThinkLoop.seed(1, 1, 1)).isNotEqualTo(ThinkLoop.seed(1, 2, 1));
    assertThat(ThinkLoop.seed(1, 1, 1)).isNotEqualTo(ThinkLoop.seed(1, 1, 2));
    assertThat(ThinkLoop.seed(1, 1, 1)).isEqualTo(ThinkLoop.seed(1, 1, 1));
    assertThat(ThinkLoop.aligned(7, 0, 5)).isEqualTo(5);
    assertThat(ThinkLoop.aligned(7, 1, 5)).isEqualTo(4);
    assertThat(ThinkLoop.due(ThinkLoop.NEVER, 0, 5)).isTrue();
    assertThat(ThinkLoop.due(-1, 0, 5)).isFalse();
    assertThat(ThinkLoop.due(5, 9, 5)).isFalse();
    assertThat(ThinkLoop.due(5, 10, 5)).isTrue();
    assertThat(ThinkLoop.rayEstimate(Fixtures.combatant(1, RED, Vec3.ZERO), snapshot(1), 64))
        .isEqualTo(3);
  }

  private static void await(BooleanSupplier condition) throws InterruptedException {
    var deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
    while (!condition.getAsBoolean()) {
      if (System.nanoTime() > deadline) {
        throw new AssertionError("condition not met within 10s");
      }
      Thread.sleep(5);
    }
  }
}
