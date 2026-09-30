package com.shepherdjerred.thestorm.tracks.adapter.luckperms;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import org.junit.jupiter.api.Test;

final class KeyedQueueTest {

  private final KeyedQueue<String> queue = new KeyedQueue<>();
  private final List<String> started = new ArrayList<>();

  private CompletableFuture<Void> step(String name, CompletableFuture<Void> finish) {
    return queue.submit(
        "alice",
        () -> {
          started.add(name);
          return finish;
        });
  }

  @Test
  void aLaterStepWaitsForTheEarlierOne() {
    var first = new CompletableFuture<Void>();
    var second = new CompletableFuture<Void>();

    var firstDone = step("first", first);
    var secondDone = step("second", second);

    assertThat(started).containsExactly("first");
    first.complete(null);
    assertThat(started).containsExactly("first", "second");
    assertThat(firstDone).isDone();
    assertThat(secondDone).isNotDone();
    second.complete(null);
    assertThat(secondDone).isCompleted();
  }

  @Test
  void aFailedStepDoesNotBlockTheNextAndReportsItsOwnFailure() {
    var first = new CompletableFuture<Void>();

    var firstDone = step("first", first);
    var secondDone = step("second", CompletableFuture.completedFuture(null));
    first.completeExceptionally(new IllegalStateException("LuckPerms is down"));

    assertThatThrownBy(firstDone::join).isInstanceOf(CompletionException.class);
    assertThat(secondDone).isCompleted();
    assertThat(started).containsExactly("first", "second");
  }

  @Test
  void aStepThatThrowsFailsOnlyItself() {
    var failing =
        queue.submit(
            "alice",
            () -> {
              throw new IllegalStateException("boom");
            });
    var next = step("next", CompletableFuture.completedFuture(null));

    assertThatThrownBy(failing::join).isInstanceOf(CompletionException.class);
    assertThat(next).isCompleted();
  }

  @Test
  void differentKeysRunIndependently() {
    var alice = new CompletableFuture<Void>();
    var _ = step("alice", alice);

    var bob =
        queue.submit(
            "bob",
            () -> {
              started.add("bob");
              return CompletableFuture.completedFuture(null);
            });

    assertThat(bob).isCompleted();
    assertThat(started).containsExactly("alice", "bob");
  }

  @Test
  void finishedKeysAreForgotten() {
    var first = new CompletableFuture<Void>();
    var _ = step("first", first);
    assertThat(queue.activeKeys()).isEqualTo(1);

    first.complete(null);

    assertThat(queue.activeKeys()).isZero();
  }

  @Test
  void completingTheReturnedFutureDoesNotSkipTheQueue() {
    var first = new CompletableFuture<Void>();
    var firstDone = step("first", first);
    firstDone.complete(null);

    var _ = step("second", CompletableFuture.completedFuture(null));

    assertThat(started).containsExactly("first");
  }
}
