package com.shepherdjerred.thestorm.mechanics.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.mechanics.domain.grid.Direction;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.NetworkAccess;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.Stargate;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.StargateFrame;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.StargateNetwork;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import org.junit.jupiter.api.Test;

final class StargateBookTest {
  private static Stargate gate(long id, UUID network, UUID owner, boolean alwaysOpen) {
    var x = Math.toIntExact(id * 10);
    return new Stargate(
        new UUID(1, id),
        network,
        "Gate" + id,
        owner,
        new UUID(0, 100),
        new Pos(x - 1, 65, -1),
        new StargateFrame(new Pos(x, 63, 0), Direction.EAST),
        alwaysOpen ? "Destination" : null,
        alwaysOpen);
  }

  @Test
  void limitsAlwaysOpenGatesPerOwnerAcrossNetworksAndReleasesSlotsOnRemoval() {
    var owner = new UUID(0, 2);
    var other = new UUID(0, 3);
    var network = new StargateNetwork(new UUID(0, 1), "Roads", new NetworkAccess.Public());
    var another = new StargateNetwork(new UUID(0, 4), "Other", new NetworkAccess.Public());
    var initial =
        List.of(
            gate(1, network.id(), owner, true),
            gate(2, network.id(), owner, true),
            gate(3, another.id(), owner, true),
            gate(4, another.id(), owner, true));
    var store = new FakeStore();
    store.snapshot = new StargateStore.Snapshot(List.of(network, another), initial);
    store.write = CompletableFuture.completedFuture(null);
    var book = new StargateBook(store, Runnable::run);
    book.load().join();
    assertThat(book.canCreateAlwaysOpen(owner)).isFalse();
    assertThat(book.canCreateAlwaysOpen(other)).isTrue();
    assertThatThrownBy(() -> book.createGate(gate(5, network.id(), owner, true)))
        .isInstanceOf(StargateBook.AlwaysOpenLimitException.class);
    var newNetwork = new StargateNetwork(new UUID(0, 5), "New", new NetworkAccess.Public());
    assertThatThrownBy(
            () -> book.createNetworkAndGate(newNetwork, gate(6, newNetwork.id(), owner, true)))
        .isInstanceOf(StargateBook.AlwaysOpenLimitException.class);
    assertThat(book.registry().network("New")).isEmpty();
    book.createGate(gate(7, network.id(), owner, false)).join();
    book.createGate(gate(8, network.id(), other, true)).join();
    book.deleteGate(initial.getFirst().id()).join();
    assertThat(book.canCreateAlwaysOpen(owner)).isTrue();
    book.createGate(gate(9, network.id(), owner, true)).join();
    assertThat(book.canCreateAlwaysOpen(owner)).isFalse();
  }

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
    private Snapshot snapshot = new Snapshot(List.of(), List.of());

    @Override
    public CompletableFuture<Snapshot> load() {
      return CompletableFuture.completedFuture(snapshot);
    }

    @Override
    public CompletableFuture<Void> createNetwork(StargateNetwork network) {
      return write;
    }

    @Override
    public CompletableFuture<Void> createGate(Stargate gate) {
      return write;
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
      return CompletableFuture.completedFuture(true);
    }

    @Override
    public CompletableFuture<Void> resetPlayer(UUID player) {
      throw new UnsupportedOperationException();
    }
  }
}
