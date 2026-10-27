package com.shepherdjerred.thestorm.reset.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.reset.PlayerResetRegistry;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import org.junit.jupiter.api.Test;

final class PlayerResetServiceTest {

  private static final UUID PLAYER = new UUID(0, 1);

  @Test
  void runsTheWholeResetAndCoalescesDuplicateCalls() {
    var calls = new ArrayList<String>();
    var store = new MemoryStore(calls);
    var registry = registry(calls);
    var releaseVanilla = new CompletableFuture<Void>();
    var service =
        new PlayerResetService(
            store,
            registry,
            new Operations(calls, releaseVanilla),
            new PlayerResetService.Timing(
                new DirectScheduler(), InstantSource.fixed(Instant.EPOCH), message -> {}));

    var first = service.reset(PLAYER);
    var second = service.reset(PLAYER);

    assertThat(second).isSameAs(first);
    assertThat(first).isNotDone();
    releaseVanilla.complete(null);
    assertThat(first).succeedsWithin(Duration.ofSeconds(1));
    assertThat(calls)
        .containsExactly("begin", "kick", "modules", "vanilla", "permissions", "finish");
  }

  @Test
  void failureLeavesThePendingMarkerAndCanBeRetried() {
    var calls = new ArrayList<String>();
    var store = new MemoryStore(calls);
    var operations =
        new Operations(calls, CompletableFuture.completedFuture("done").thenAccept(ignored -> {}));
    operations.failVanilla = true;
    var service =
        new PlayerResetService(
            store,
            registry(calls),
            operations,
            new PlayerResetService.Timing(
                new DirectScheduler(), InstantSource.system(), message -> {}));

    assertThat(service.reset(PLAYER)).failsWithin(Duration.ofSeconds(1));
    assertThat(store.pending).containsExactly(PLAYER);
    assertThat(store.finished).isEmpty();

    operations.failVanilla = false;
    assertThat(service.reset(PLAYER)).succeedsWithin(Duration.ofSeconds(1));
    assertThat(store.pending).isEmpty();
  }

  @Test
  void resumeRunsEveryPendingReset() {
    var calls = new ArrayList<String>();
    var store = new MemoryStore(calls);
    store.pending.add(PLAYER);
    var service =
        new PlayerResetService(
            store,
            registry(calls),
            new Operations(
                calls, CompletableFuture.completedFuture("done").thenAccept(ignored -> {})),
            new PlayerResetService.Timing(
                new DirectScheduler(), InstantSource.system(), message -> {}));

    assertThat(service.resume()).succeedsWithin(Duration.ofSeconds(1));
    assertThat(store.pending).isEmpty();
    assertThat(store.finished).containsExactly(PLAYER);
  }

  private static PlayerResetRegistry registry(List<String> calls) {
    var registry = new PlayerResetRegistry();
    registry.register(
        "core",
        player -> {
          calls.add("modules");
          return CompletableFuture.completedFuture("done").thenAccept(ignored -> {});
        });
    registry.complete(Set.of());
    return registry;
  }

  private static final class MemoryStore implements ResetStore {
    private final Set<UUID> pending = new HashSet<>();
    private final Set<UUID> finished = new HashSet<>();
    private final List<String> calls;

    private MemoryStore(List<String> calls) {
      this.calls = calls;
    }

    @Override
    public CompletableFuture<Void> begin(UUID player, Instant startedAt) {
      calls.add("begin");
      pending.add(player);
      return CompletableFuture.completedFuture("done").thenAccept(ignored -> {});
    }

    @Override
    public CompletableFuture<Set<UUID>> pending() {
      return CompletableFuture.completedFuture(Set.copyOf(pending));
    }

    @Override
    public CompletableFuture<Boolean> isPending(UUID player) {
      return CompletableFuture.completedFuture(pending.contains(player));
    }

    @Override
    public CompletableFuture<Void> finish(UUID player) {
      calls.add("finish");
      pending.remove(player);
      finished.add(player);
      return CompletableFuture.completedFuture("done").thenAccept(ignored -> {});
    }
  }

  private static final class Operations implements ResetOperations {
    private final List<String> calls;
    private final CompletableFuture<Void> vanilla;
    private boolean failVanilla;

    private Operations(List<String> calls, CompletableFuture<Void> vanilla) {
      this.calls = calls;
      this.vanilla = vanilla;
    }

    @Override
    public void kick(UUID player) {
      calls.add("kick");
    }

    @Override
    public CompletableFuture<Void> eraseVanilla(UUID player) {
      calls.add("vanilla");
      if (failVanilla) {
        return CompletableFuture.failedFuture(new IllegalStateException("delete failed"));
      }
      return vanilla.isDone() ? vanilla : vanilla.thenApply(ignored -> null);
    }

    @Override
    public CompletableFuture<Void> clearPermissions(UUID player) {
      calls.add("permissions");
      return CompletableFuture.completedFuture("done").thenAccept(ignored -> {});
    }
  }

  private static final class DirectScheduler implements Scheduler {
    @Override
    public void runOnMainThread(Runnable task) {
      task.run();
    }

    @Override
    public Cancellable runOnMainThreadLater(Duration delay, Runnable task) {
      throw new UnsupportedOperationException();
    }

    @Override
    public Cancellable repeatOnMainThread(Duration delay, Duration period, Runnable task) {
      throw new UnsupportedOperationException();
    }

    @Override
    public Executor mainThread() {
      return Runnable::run;
    }
  }
}
