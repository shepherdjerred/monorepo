package com.shepherdjerred.thestorm.rwf.adapter.paper.details;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.compute.ComputePool;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.rwf.adapter.content.details.MapDetails;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import java.lang.reflect.Proxy;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.stream.IntStream;
import org.bukkit.World;
import org.junit.jupiter.api.Test;

final class DetailsRestorerTest {
  private static final BlockPos ORIGIN = new BlockPos(0, 64, 0);

  @Test
  void largeInventoriesOwnTheirBatchAndSmallPayloadsRetainTheEntryLimit() {
    var large = Base64.getEncoder().encodeToString(new byte[1_048_576]);
    var small = Base64.getEncoder().encodeToString(new byte[24_576]);
    var big = details(large);
    var medium = details(small);
    assertThat(DetailsRestorer.batchEnd(big, 0)).isEqualTo(1);
    assertThat(DetailsRestorer.batchEnd(big, 1)).isEqualTo(2);
    assertThat(DetailsRestorer.batchEnd(medium, 0)).isEqualTo(2);
    assertThat(DetailsRestorer.batchEnd(details("AA=="), 0)).isEqualTo(8);
  }

  @Test
  void decodingFailureReturnsThroughMainThreadWithoutTouchingWorldState() {
    var compute = new DeferredCompute();
    var scheduler = new DeferredScheduler();
    var result =
        DetailsRestorer.restore(
            new DetailsRestorer.Target(scheduler, compute, noWorldAccess(), ORIGIN),
            details("AA=="),
            () -> true);
    assertThat(result).isNotDone();
    assertThat(compute.tasks).hasSize(1);
    assertThat(scheduler.tasks).isEmpty();
    compute.tasks.remove().run();
    assertThat(result).isNotDone();
    assertThat(scheduler.tasks).hasSize(1);
    scheduler.tasks.remove().run();
    assertThat(result).isCompletedExceptionally();
    assertThatThrownBy(result::join).hasCauseInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void staleMapAfterDecodeDiscardsTheBatchBeforeAnyWorldAccess() {
    var compute = new DeferredCompute();
    var scheduler = new DeferredScheduler();
    var current = new AtomicBoolean(true);
    var face = new MapDetails.Face(List.of("", "", "", ""), "BLACK", false);
    var sign = new MapDetails.Sign(new BlockPos(0, 0, 0), "minecraft:oak_sign", face, face, false);
    var details = new MapDetails(1, "a".repeat(64), List.of(), List.of(sign));
    var result =
        DetailsRestorer.restore(
            new DetailsRestorer.Target(scheduler, compute, noWorldAccess(), ORIGIN),
            details,
            current::get);
    compute.tasks.remove().run();
    current.set(false);
    scheduler.tasks.remove().run();
    assertThat(result).isCompletedWithValue(false);
  }

  private static MapDetails details(String payload) {
    return new MapDetails(
        1,
        "a".repeat(64),
        IntStream.range(0, 9)
            .mapToObj(
                index ->
                    new MapDetails.Container(new BlockPos(index, 0, 0), "minecraft:chest", payload))
            .toList(),
        List.of());
  }

  private static World noWorldAccess() {
    return (World)
        Proxy.newProxyInstance(
            World.class.getClassLoader(),
            new Class<?>[] {World.class},
            (_, method, _) -> {
              throw new AssertionError(
                  "World accessed before a current main-thread batch: " + method.getName());
            });
  }

  private static final class DeferredCompute implements ComputePool {
    final ArrayDeque<Runnable> tasks = new ArrayDeque<>();

    @Override
    public Executor executor() {
      return tasks::add;
    }

    @Override
    public void close() {
      tasks.clear();
    }
  }

  private static final class DeferredScheduler implements Scheduler {
    final ArrayDeque<Runnable> tasks = new ArrayDeque<>();

    @Override
    public Executor mainThread() {
      return tasks::add;
    }

    @Override
    public void runOnMainThread(Runnable task) {
      tasks.add(task);
    }

    @Override
    public Cancellable runOnMainThreadLater(Duration delay, Runnable task) {
      tasks.add(task);
      return () -> tasks.remove(task);
    }

    @Override
    public Cancellable repeatOnMainThread(Duration delay, Duration period, Runnable task) {
      throw new UnsupportedOperationException("repeat not used by payload restoration");
    }
  }
}
