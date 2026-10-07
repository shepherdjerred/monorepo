package com.shepherdjerred.thestorm.rwfbots.app.learning;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.compute.ComputePool;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.SplittableRandom;
import java.util.UUID;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import org.junit.jupiter.api.Test;

final class BatchedInferenceTest {
  private static final class ManualPool implements ComputePool {
    final ArrayDeque<Runnable> jobs = new ArrayDeque<>();
    boolean rejected;
    boolean executing;

    @Override
    public Executor executor() {
      return job -> {
        if (rejected) throw new RejectedExecutionException("test saturation");
        jobs.addLast(job);
      };
    }

    void run() {
      executing = true;
      try {
        jobs.removeFirst().run();
      } finally {
        executing = false;
      }
    }

    @Override
    public void close() {
      rejected = true;
    }
  }

  private static final class Actor implements RecurrentActor {
    final ManualPool pool;
    final List<Input> inputs = new ArrayList<>();
    boolean closed;
    boolean failed;

    Actor(ManualPool pool) {
      this.pool = pool;
    }

    @Override
    public Output forward(Input input) {
      assertThat(pool.executing).isTrue();
      if (failed) throw new IllegalArgumentException("corrupt model output");
      inputs.add(input);
      var rows = input.observation().rows();
      var hidden = input.hidden().values();
      var cell = input.cell().values();
      for (var index = 0; index < hidden.length; index++) {
        hidden[index]++;
        cell[index]++;
      }
      return new Output(
          new ActorMatrix(rows, LOGITS, new float[rows * LOGITS]),
          new ActorMatrix(rows, HIDDEN, hidden),
          new ActorMatrix(rows, HIDDEN, cell));
    }

    @Override
    public void close() {
      assertThat(pool.executing).isTrue();
      closed = true;
    }
  }

  private static InferenceRequest request(int body, long tick) {
    return new InferenceRequest(
        new InferenceRequest.Identity(new UUID(0, 1), new UUID(1, body), 0, Kit.TROOPER),
        tick,
        90,
        Collections.nCopies(34, 0.0));
  }

  private static BatchedInference owner(Actor actor, ManualPool pool) {
    return new BatchedInference(
        new BatchedInference.Parts(actor, pool, new SplittableRandom(1), () -> 0));
  }

  @Test
  void pendingInferenceClosesAfterExecutorStopsAcceptingWork() {
    var pool = new ManualPool();
    var actor = new Actor(pool);
    var owner = owner(actor, pool);
    owner.tick(10, List.of(request(1, 10)));
    owner.close();
    pool.close();
    pool.run();
    pool.run();
    assertThat(actor.closed).isTrue();
    assertThat(owner.closing().orElseThrow().getNow(false)).isTrue();
    assertThat(pool.jobs).isEmpty();
  }

  @Test
  void oneBatchCarriesIndependentMemoryForAllBodies() {
    var pool = new ManualPool();
    var actor = new Actor(pool);
    var owner = owner(actor, pool);
    owner.tick(10, List.of(request(1, 10), request(2, 10)));
    assertThat(pool.jobs).hasSize(1);
    assertThat(owner.action(request(1, 10))).isEmpty();
    pool.run();
    assertThat(owner.action(request(1, 11)).orElseThrow().tick()).isEqualTo(10);
    assertThat(owner.action(request(2, 11))).isPresent();
    owner.tick(11, List.of(request(1, 11), request(2, 11)));
    pool.run();
    assertThat(actor.inputs).hasSize(2);
    assertThat(actor.inputs.get(1).hidden().values()).containsOnly(1f);
    assertThat(owner.metrics().timely()).isEqualTo(2);
    owner.close();
    assertThat(actor.closed).isFalse();
    pool.run();
    assertThat(actor.closed).isTrue();
  }

  @Test
  void slowBatchesAreNotQueuedAndExpiredResultsCannotControlBodies() {
    var pool = new ManualPool();
    var actor = new Actor(pool);
    var owner = owner(actor, pool);
    owner.tick(10, List.of(request(1, 10)));
    owner.tick(11, List.of(request(1, 11)));
    owner.tick(12, List.of(request(1, 12)));
    assertThat(pool.jobs).hasSize(1);
    assertThat(owner.metrics().skipped()).isEqualTo(2);
    pool.run();
    owner.tick(13, List.of(request(1, 13)));
    assertThat(owner.action(request(1, 13))).isEmpty();
    assertThat(owner.metrics().stale()).isEqualTo(1);
    assertThat(owner.metrics().expired()).isEqualTo(1);
    assertThat(owner.metrics().contextDrops()).isZero();
    pool.run();
    assertThat(actor.inputs.get(1).hidden().values()).containsOnly(0f);
    owner.close();
    pool.run();
  }

  @Test
  void twoTickLimitAndIdentityChangesRejectOldActions() {
    var pool = new ManualPool();
    var actor = new Actor(pool);
    var owner = owner(actor, pool);
    owner.tick(10, List.of(request(1, 10)));
    pool.run();
    assertThat(owner.action(request(1, 12))).isPresent();
    assertThat(owner.action(request(1, 13))).isEmpty();
    var old = request(1, 13);
    for (var identity :
        List.of(
            new InferenceRequest.Identity(
                old.identity().match(), old.identity().body(), 1, Kit.TROOPER),
            new InferenceRequest.Identity(
                old.identity().match(), old.identity().body(), 0, Kit.LONGBOW),
            new InferenceRequest.Identity(new UUID(0, 2), old.identity().body(), 0, Kit.TROOPER),
            new InferenceRequest.Identity(
                old.identity().match(), new UUID(1, 3), 0, Kit.TROOPER))) {
      assertThat(owner.action(new InferenceRequest(identity, 13, 90, old.observation()))).isEmpty();
    }
    owner.close();
    pool.run();
  }

  @Test
  void removedBodiesCannotReceiveAnOldCompletionEvenIfTheirIdentityIsReused() {
    var pool = new ManualPool();
    var actor = new Actor(pool);
    var owner = owner(actor, pool);
    owner.tick(10, List.of(request(1, 10)));
    owner.tick(11, List.of());
    pool.run();
    owner.tick(12, List.of(request(1, 12)));
    assertThat(owner.action(request(1, 12))).isEmpty();
    assertThat(owner.metrics().stale()).isEqualTo(1);
    assertThat(owner.metrics().contextDrops()).isEqualTo(1);
    assertThat(owner.metrics().expired()).isZero();
    pool.run();
    owner.close();
    pool.run();
  }

  @Test
  void memoryResetsAfterObservationGapsAndChangedLives() {
    var pool = new ManualPool();
    var actor = new Actor(pool);
    var owner = owner(actor, pool);
    owner.tick(10, List.of(request(1, 10)));
    pool.run();
    owner.tick(12, List.of(request(1, 12)));
    pool.run();
    assertThat(actor.inputs.get(1).hidden().values()).containsOnly(0f);
    var old = request(1, 13);
    var next =
        new InferenceRequest(
            new InferenceRequest.Identity(
                old.identity().match(), old.identity().body(), 1, Kit.TROOPER),
            13,
            90,
            old.observation());
    owner.tick(13, List.of(next));
    pool.run();
    assertThat(actor.inputs.get(2).hidden().values()).containsOnly(0f);
    owner.close();
    pool.run();
  }

  @Test
  void saturationIsMeasuredButCorruptInferenceFailsLoudly() {
    var pool = new ManualPool();
    var actor = new Actor(pool);
    var owner = owner(actor, pool);
    pool.rejected = true;
    owner.tick(10, List.of(request(1, 10)));
    assertThat(owner.metrics().rejected()).isEqualTo(1);
    assertThat(owner.action(request(1, 10))).isEmpty();
    pool.rejected = false;
    actor.failed = true;
    owner.tick(11, List.of(request(1, 11)));
    pool.run();
    assertThatThrownBy(() -> owner.tick(12, List.of(request(1, 12))))
        .hasRootCauseMessage("corrupt model output");
    owner.close();
    pool.run();
  }

  @Test
  void batchSizesAreBoundedAndContextValidationIsStrict() {
    for (var size : List.of(20, 50, 100)) {
      var pool = new ManualPool();
      var actor = new Actor(pool);
      var owner = owner(actor, pool);
      var requests =
          java.util.stream.IntStream.range(1, size + 1)
              .mapToObj(body -> request(body, 10))
              .toList();
      owner.tick(10, requests);
      pool.run();
      assertThat(actor.inputs.getFirst().observation().rows()).isEqualTo(size);
      assertThat(pool.jobs).isEmpty();
      assertThatIllegalArgumentException().isThrownBy(() -> owner.tick(10, requests));
      assertThatIllegalArgumentException()
          .isThrownBy(() -> owner.tick(11, List.of(request(1, 11), request(1, 11))));
      assertThatIllegalArgumentException()
          .isThrownBy(() -> owner.tick(11, List.of(request(1, 12))));
      owner.close();
      pool.run();
    }
  }
}
