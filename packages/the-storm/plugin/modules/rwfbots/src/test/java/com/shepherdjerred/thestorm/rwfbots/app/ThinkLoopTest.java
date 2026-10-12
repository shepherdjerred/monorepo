package com.shepherdjerred.thestorm.rwfbots.app;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static org.assertj.core.api.Assertions.assertThat;

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
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
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
import java.util.concurrent.atomic.AtomicLong;
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
    return new BotProfile(
        id,
        slot,
        "bot-" + id.value(),
        RED,
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
        List.of());
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
  void theRayBudgetDefersBotsThatAlreadyHaveAPercept() {
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
    assertThat(loop.board().perceived()).as("first percepts are never deferred").isEqualTo(2);
    loop.publish(snapshot(3));

    assertThat(loop.board().perceived()).isEqualTo(1);
    assertThat(loop.board().deferred()).isEqualTo(1);
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
