package com.shepherdjerred.thestorm.rwf.app.map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Random;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;

class MapRotationTest {
  private static final class Entry implements MapRotation.Entry {
    private final String id;
    private Consumer<Boolean> completion = _ -> {};
    private int prepares;
    private int releases;

    Entry(String id) {
      this.id = id;
    }

    @Override
    public String id() {
      return id;
    }

    @Override
    public void prepare(Consumer<Boolean> done) {
      prepares++;
      completion = done;
    }

    @Override
    public void release() {
      releases++;
    }
  }

  @Test
  void waitsForSuccessBeforeReleasingTheActiveMapAndRejectsConcurrentPrefetch() {
    var active = new Entry("one");
    var next = new Entry("two");
    try (var rotation = new MapRotation<>(List.of(active, next), new Random(1))) {
      rotation.prefetch(active);
      var ready = new AtomicInteger();
      rotation.whenReady(
          ready::incrementAndGet,
          failure -> {
            throw new AssertionError(failure);
          });
      assertThatThrownBy(() -> rotation.take(active)).isInstanceOf(IllegalStateException.class);
      assertThatThrownBy(() -> rotation.prefetch(active)).isInstanceOf(IllegalStateException.class);
      assertThat(active.releases).isZero();
      assertThat(active.prepares).isZero();
      assertThat(next.prepares).isEqualTo(1);
      assertThat(ready.get()).isZero();
      next.completion.accept(true);
      assertThat(ready.get()).isEqualTo(1);
      assertThat(rotation.take(active)).isSameAs(next);
      assertThat(active.releases).isEqualTo(1);
      assertThat(next.releases).isZero();
    }
  }

  @Test
  void failedPreparationNeverAdvancesOrReleasesTheActiveMap() {
    var active = new Entry("one");
    var next = new Entry("two");
    try (var rotation = new MapRotation<>(List.of(active, next), new Random(2))) {
      rotation.prefetch(active);
      var failed = new AtomicInteger();
      rotation.whenReady(
          () -> {
            throw new AssertionError("failed map admitted");
          },
          _ -> failed.incrementAndGet());
      next.completion.accept(false);
      assertThat(failed.get()).isEqualTo(1);
      assertThatThrownBy(() -> rotation.take(active)).isInstanceOf(IllegalStateException.class);
      assertThat(active.releases).isZero();
    }
  }

  @Test
  void closingIgnoresLatePreparationAndCannotReopenTheLobby() {
    var active = new Entry("one");
    var next = new Entry("two");
    var rotation = new MapRotation<>(List.of(active, next), new Random(3));
    rotation.prefetch(active);
    var callbacks = new AtomicInteger();
    rotation.whenReady(callbacks::incrementAndGet, _ -> callbacks.incrementAndGet());
    rotation.close();
    next.completion.accept(true);
    assertThat(callbacks.get()).isZero();
    assertThatThrownBy(() -> rotation.take(active)).isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(() -> rotation.prefetch(active)).isInstanceOf(IllegalStateException.class);
  }

  @Test
  void aSingleMapReusesTheAlreadyPreparedActiveTerrain() {
    var active = new Entry("only");
    try (var rotation = new MapRotation<>(List.of(active), new Random(4))) {
      rotation.prefetch(active);
      assertThat(rotation.take(active)).isSameAs(active);
      assertThat(active.prepares).isZero();
      assertThat(active.releases).isZero();
    }
  }
}
