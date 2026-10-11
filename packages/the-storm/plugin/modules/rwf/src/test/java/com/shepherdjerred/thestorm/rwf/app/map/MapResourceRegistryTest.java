package com.shepherdjerred.thestorm.rwf.app.map;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.Test;

final class MapResourceRegistryTest {
  private static final class Resource implements MapResources.Handler {
    private final CompletableFuture<Void> ready = new CompletableFuture<>();
    private final List<String> released = new ArrayList<>();

    @Override
    public CompletableFuture<Void> prepare(String mapId) {
      return ready;
    }

    @Override
    public void release(String mapId) {
      released.add(mapId);
    }
  }

  @Test
  void mapWaitsForEveryResourceAndReleaseReachesOnlyCurrentSubscribers() {
    var registry = new MapResourceRegistry();
    var terrain = new Resource();
    var navigation = new Resource();
    registry.register(terrain);
    var subscription = registry.register(navigation);
    var preparation = registry.prepare(Samples.twoTeams());
    terrain.ready.complete(null);
    assertThat(preparation).isNotDone();
    navigation.ready.complete(null);
    assertThat(preparation).isCompletedWithValue(null);
    registry.release("first");
    subscription.close();
    registry.release("second");
    assertThat(terrain.released).containsExactly("first", "second");
    assertThat(navigation.released).containsExactly("first");
  }

  @Test
  void failedRequiredResourcePreventsAdmission() {
    var registry = new MapResourceRegistry();
    var navigation = new Resource();
    registry.register(navigation);
    var preparation = registry.prepare(Samples.twoTeams());
    navigation.ready.completeExceptionally(new IllegalStateException("corrupt navigation"));
    assertThat(preparation).isCompletedExceptionally();
  }
}
