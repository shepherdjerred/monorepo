package com.shepherdjerred.thestorm.rwfbots.app.learning;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.compute.ComputePool;
import com.shepherdjerred.thestorm.rwf.app.ObservationSource;
import com.shepherdjerred.thestorm.rwfbots.app.CombatHarness;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.learning.ObservationContract;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Reflex;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexInput;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.SplittableRandom;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

final class MatchLearningTest {
  private static final UUID MATCH = new UUID(0, 1);
  private static final UUID NEXT = new UUID(0, 2);
  private static final UUID BODY = new UUID(1, 1);

  private static final class Gate implements LearningGate {
    final List<Context> contexts = new ArrayList<>();
    final ArrayDeque<CompletableFuture<LearningGate.Decision>> answers = new ArrayDeque<>();
    boolean closed;

    @Override
    public CompletableFuture<LearningGate.Decision> evaluate(Context context) {
      contexts.add(context);
      return answers.removeFirst();
    }

    @Override
    public void close() {
      closed = true;
    }
  }

  private static final class Pool implements ComputePool {
    final ArrayDeque<Runnable> jobs = new ArrayDeque<>();

    @Override
    public Executor executor() {
      return jobs::addLast;
    }

    @Override
    public void close() {}

    void run() {
      jobs.removeFirst().run();
    }
  }

  private static BatchedInference model(Pool pool) {
    var actor =
        new RecurrentActor() {
          @Override
          public Output forward(Input input) {
            int rows = input.observation().rows();
            var logits = new float[rows * LOGITS];
            Arrays.fill(logits, -100f);
            for (int row = 0; row < rows; row++)
              for (int index : List.of(7, 10, 11, 13, 15)) logits[row * LOGITS + index] = 100f;
            return new Output(new ActorMatrix(rows, LOGITS, logits), input.hidden(), input.cell());
          }

          @Override
          public void close() {}
        };
    return new BatchedInference(
        new BatchedInference.Parts(actor, pool, new SplittableRandom(1), () -> 0));
  }

  private static LearningGate.Context context(UUID match) {
    return new LearningGate.Context(match, "training-yard", "rwf", 123);
  }

  private static CombatHarness.Frame frame(long tick, int life, boolean healing, Kit kit) {
    var self =
        new CombatantView(
            combatant(1, RED, new Vec3(5, 1, 5)).id(),
            RED,
            false,
            kit,
            true,
            new Vec3(5, 1, 5),
            Vec3.ZERO,
            0,
            0,
            20,
            0,
            15,
            1,
            false,
            true,
            healing,
            false,
            -1);
    var target = combatant(2, BLUE, new Vec3(7, 1, 5));
    var snapshot =
        new WorldSnapshot(
            tick,
            MatchPhase.LIVE,
            List.of(self, target),
            List.of(),
            PoisonView.NONE,
            "test",
            List.of());
    var input =
        new ReflexInput(self, snapshot, Decision.idle(self.id(), tick, 1), Optional.of(target), 3);
    var authored =
        new Reflex.Step(
            ReflexState.initial(Facing.SOUTH),
            List.of(
                new BodyCommand.Look(90, 5),
                new BodyCommand.SelectSlot(1),
                new BodyCommand.Stop()));
    return new CombatHarness.Frame(
        MATCH,
        BODY,
        life,
        input,
        Optional.of(new UUID(9, 10)),
        authored,
        Optional.of(
            new ObservationSource.Sample(ObservationContract.ID, Collections.nCopies(34, 0.0))));
  }

  @Test
  void absenceFalseAndOutagesRemainOffAndNeverLoad() {
    var loads = new AtomicInteger();
    var gate = new Gate();
    for (var source : LearningGate.Source.values()) {
      gate.answers.add(CompletableFuture.completedFuture(new LearningGate.Decision(false, source)));
    }
    var learning =
        new MatchLearning(
            new MatchLearning.Parts(
                gate,
                () -> {
                  loads.incrementAndGet();
                  throw new IllegalStateException("disabled matches must not load");
                },
                answer -> {}));
    for (int index = 0; index < 3; index++) {
      learning.begin(context(new UUID(0, index + 1)));
      learning.startTick(index * 2L + 1);
      learning.startTick(index * 2L + 2);
      assertThat(learning.active(MATCH)).isFalse();
      assertThat(learning.commands(frame(index + 1, 0, false, Kit.TROOPER)))
          .isEqualTo(frame(index + 1, 0, false, Kit.TROOPER).authored().commands());
      learning.end();
    }
    assertThat(gate.contexts).hasSize(3);
    assertThat(loads).hasValue(0);
    assertThat(learning.metrics().gateUnavailable()).isEqualTo(1);
    learning.close();
    assertThat(gate.closed).isTrue();
  }

  @Test
  void lateFlagCannotLoadAnEndedMatchOrFlipItsSuccessor() {
    var gate = new Gate();
    var late = new CompletableFuture<LearningGate.Decision>();
    gate.answers.add(late);
    gate.answers.add(
        CompletableFuture.completedFuture(
            new LearningGate.Decision(false, LearningGate.Source.FLIPT)));
    var loads = new AtomicInteger();
    var learning =
        new MatchLearning(
            new MatchLearning.Parts(
                gate,
                () -> {
                  loads.incrementAndGet();
                  return new CompletableFuture<>();
                },
                answer -> {}));
    learning.begin(context(MATCH));
    learning.startTick(1);
    learning.end();
    learning.begin(context(NEXT));
    late.complete(new LearningGate.Decision(true, LearningGate.Source.FLIPT));
    learning.startTick(2);
    assertThat(loads).hasValue(0);
    assertThat(learning.active(NEXT)).isFalse();
    assertThat(gate.contexts).containsExactly(context(MATCH), context(NEXT));
    learning.close();
  }

  @Test
  void pendingAndLateWarmupNeverControlAnotherMatch() {
    var gate = new Gate();
    gate.answers.add(
        CompletableFuture.completedFuture(
            new LearningGate.Decision(true, LearningGate.Source.FLIPT)));
    gate.answers.add(
        CompletableFuture.completedFuture(
            new LearningGate.Decision(false, LearningGate.Source.FLIPT)));
    var loading = new CompletableFuture<BatchedInference>();
    var learning = new MatchLearning(new MatchLearning.Parts(gate, () -> loading, answer -> {}));
    learning.begin(context(MATCH));
    learning.startTick(1);
    assertThat(learning.active(MATCH)).isFalse();
    var authored = frame(1, 0, false, Kit.TROOPER);
    assertThat(learning.commands(authored)).isEqualTo(authored.authored().commands());
    learning.end();
    learning.begin(context(NEXT));
    var pool = new Pool();
    var model = model(pool);
    loading.complete(model);
    learning.startTick(2);
    assertThat(learning.active(NEXT)).isFalse();
    assertThat(model.metrics().submitted()).isZero();
    learning.close();
    model.close();
    pool.run();
  }

  @Test
  void learnedMovementPreservesAimHealingAndOtherKitsAndResetsAcrossGovernorGaps() {
    var pool = new Pool();
    var model = model(pool);
    var gate = new Gate();
    gate.answers.add(
        CompletableFuture.completedFuture(
            new LearningGate.Decision(true, LearningGate.Source.FLIPT)));
    var learning =
        new MatchLearning(
            new MatchLearning.Parts(
                gate, () -> CompletableFuture.completedFuture(model), answer -> {}));
    learning.begin(context(MATCH));
    learning.startTick(1);
    var first = frame(1, 0, false, Kit.TROOPER);
    assertThat(learning.commands(first)).isEqualTo(first.authored().commands());
    learning.finishTick(MATCH, 1);
    pool.run();
    learning.startTick(2);
    var learned = learning.commands(frame(2, 0, false, Kit.TROOPER));
    assertThat(learned).contains(new BodyCommand.Look(90, 5), new BodyCommand.SelectSlot(1));
    assertThat(learned).anyMatch(BodyCommand.MoveToward.class::isInstance);
    var healing = frame(2, 0, true, Kit.TROOPER);
    assertThat(learning.commands(healing)).isEqualTo(healing.authored().commands());
    var other = frame(2, 0, false, Kit.LONGBOW);
    assertThat(learning.commands(other)).isEqualTo(other.authored().commands());
    // The governor drove no body this tick. The empty batch retires its memory and ticket.
    learning.startTick(3);
    learning.finishTick(MATCH, 3);
    learning.startTick(4);
    var fresh = frame(4, 0, false, Kit.TROOPER);
    assertThat(learning.commands(fresh)).isEqualTo(fresh.authored().commands());
    learning.finishTick(MATCH, 4);
    pool.run();
    assertThat(learning.commands(frame(5, 1, false, Kit.TROOPER)))
        .isEqualTo(frame(5, 1, false, Kit.TROOPER).authored().commands());
    assertThat(learning.metrics().applied()).isEqualTo(1);
    assertThat(learning.metrics().ineligible()).isEqualTo(1);
    assertThat(model.metrics().resets()).isGreaterThanOrEqualTo(3);
    learning.close();
    model.close();
    pool.run();
  }

  @Test
  void retiredCompletionsAreDrainedDuringIdleTicks() {
    var pool = new Pool();
    var model = model(pool);
    var gate = new Gate();
    gate.answers.add(
        CompletableFuture.completedFuture(
            new LearningGate.Decision(true, LearningGate.Source.FLIPT)));
    var learning =
        new MatchLearning(
            new MatchLearning.Parts(
                gate, () -> CompletableFuture.completedFuture(model), answer -> {}));
    learning.begin(context(MATCH));
    learning.startTick(1);
    learning.commands(frame(1, 0, false, Kit.TROOPER));
    learning.finishTick(MATCH, 1);
    learning.end();
    pool.run();
    learning.startTick(4);
    assertThat(model.metrics().contextDrops()).isEqualTo(1);
    assertThat(model.metrics().deadlineMissed()).isEqualTo(1);
    learning.close();
    model.close();
    pool.run();
  }

  @Test
  void corruptFlagAndRequiredModelFailuresRemainLoud() {
    var gate = new Gate();
    gate.answers.add(
        CompletableFuture.failedFuture(new IllegalStateException("invalid successful flag")));
    gate.answers.add(
        CompletableFuture.completedFuture(
            new LearningGate.Decision(true, LearningGate.Source.FLIPT)));
    var learning =
        new MatchLearning(
            new MatchLearning.Parts(
                gate,
                () ->
                    CompletableFuture.failedFuture(
                        new IllegalArgumentException("required accepted asset missing")),
                answer -> {}));
    learning.begin(context(MATCH));
    assertThatThrownBy(() -> learning.startTick(1)).hasCauseInstanceOf(IllegalStateException.class);
    learning.end();
    learning.begin(context(NEXT));
    assertThatThrownBy(() -> learning.startTick(2))
        .hasCauseInstanceOf(IllegalArgumentException.class);
    learning.close();
  }

  @Test
  void computePoolSaturationLeavesTheMatchAuthoredAndRecordsARejectedLoad() {
    var gate = new Gate();
    gate.answers.add(
        CompletableFuture.completedFuture(
            new LearningGate.Decision(true, LearningGate.Source.FLIPT)));
    var learning =
        new MatchLearning(
            new MatchLearning.Parts(
                gate,
                () -> {
                  throw new java.util.concurrent.RejectedExecutionException("test pool saturation");
                },
                answer -> {}));
    learning.begin(context(MATCH));
    learning.startTick(1);
    learning.startTick(2);
    assertThat(learning.active(MATCH)).isFalse();
    assertThat(learning.metrics().state()).isEqualTo(MatchLearning.State.OFF);
    assertThat(learning.metrics().modelRejected()).isEqualTo(1);
    assertThat(gate.contexts).hasSize(1);
    learning.close();
  }
}
