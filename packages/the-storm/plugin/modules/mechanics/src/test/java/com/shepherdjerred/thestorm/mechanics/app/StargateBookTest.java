package com.shepherdjerred.thestorm.mechanics.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.mechanics.domain.stargate.NetworkAccess;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.Stargate;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.StargateNetwork;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import org.junit.jupiter.api.Test;

final class StargateBookTest {
  @Test
  void failedWritesDoNotPublishAndConcurrentWritesAreRefused() {
    var store = new FakeStore();
    var book = new StargateBook(store, Runnable::run);
    assertThat(book.ready()).isFalse();
    book.load().join();
    var network = new StargateNetwork(new UUID(0, 1), "Roads", new NetworkAccess.Public());
    var pending = book.createNetwork(network);
    assertThat(book.ready()).isFalse();
    assertThatThrownBy(() -> book.createNetwork(network)).isInstanceOf(IllegalStateException.class);
    store.write.completeExceptionally(new IllegalStateException("disk failure"));
    assertThatThrownBy(pending::join).isInstanceOf(CompletionException.class);
    assertThat(book.ready()).isTrue();
    assertThat(book.registry().network("Roads")).isEmpty();

    store.write = new CompletableFuture<>();
    var retry = book.createNetwork(network);
    store.write.complete(null);
    retry.join();
    assertThat(book.registry().network("roads")).contains(network);
  }

  private static final class FakeStore implements StargateStore {
    private CompletableFuture<Void> write = new CompletableFuture<>();

    @Override
    public CompletableFuture<Snapshot> load() {
      return CompletableFuture.completedFuture(new Snapshot(List.of(), List.of()));
    }

    @Override
    public CompletableFuture<Void> createNetwork(StargateNetwork network) {
      return write;
    }

    @Override
    public CompletableFuture<Void> createGate(Stargate gate) {
      throw new UnsupportedOperationException();
    }

    @Override
    public CompletableFuture<Void> createNetworkAndGate(StargateNetwork network, Stargate gate) {
      return write;
    }

    @Override
    public CompletableFuture<Void> replaceInvitations(UUID networkId, Set<UUID> players) {
      throw new UnsupportedOperationException();
    }

    @Override
    public CompletableFuture<Boolean> deleteGate(UUID id) {
      throw new UnsupportedOperationException();
    }

    @Override
    public CompletableFuture<Void> resetPlayer(UUID player) {
      throw new UnsupportedOperationException();
    }
  }
}
