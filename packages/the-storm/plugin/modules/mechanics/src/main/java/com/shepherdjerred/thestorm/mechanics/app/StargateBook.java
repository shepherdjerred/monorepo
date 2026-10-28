package com.shepherdjerred.thestorm.mechanics.app;

import com.shepherdjerred.thestorm.mechanics.domain.stargate.NetworkAccess;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.Stargate;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.StargateNetwork;
import java.util.ArrayList;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.Executor;
import java.util.function.Supplier;
import org.jspecify.annotations.Nullable;

/**
 * Serializes changes and publishes them only after the durable write succeeds. Main thread only.
 */
public final class StargateBook {
  private final StargateStore store;
  private final Executor mainThread;
  private StargateStore.@Nullable Snapshot snapshot;
  private @Nullable StargateRegistry registry;
  private boolean busy;

  public StargateBook(StargateStore store, Executor mainThread) {
    this.store = store;
    this.mainThread = mainThread;
  }

  /** Before loading completes, interactions must fail closed. */
  public boolean ready() {
    return registry != null && !busy;
  }

  /** The last committed state remains available to protect existing structures during saves. */
  public java.util.Optional<StargateRegistry> committed() {
    return java.util.Optional.ofNullable(registry);
  }

  public StargateRegistry registry() {
    if (!ready()) {
      throw new IllegalStateException("Stargates are loading or saving");
    }
    return java.util.Objects.requireNonNull(registry);
  }

  public CompletableFuture<Void> load() {
    if (snapshot != null || busy) {
      return CompletableFuture.failedFuture(
          new IllegalStateException("Stargates already loaded or loading"));
    }
    busy = true;
    return store
        .load()
        .handleAsync(
            (loaded, failure) -> {
              try {
                if (failure != null) throw new CompletionException(failure);
                var validated = new StargateRegistry(loaded);
                snapshot = loaded;
                registry = validated;
                return null;
              } finally {
                busy = false;
              }
            },
            mainThread);
  }

  public CompletableFuture<Void> createNetwork(StargateNetwork network) {
    var current = current();
    var networks = new ArrayList<>(current.networks());
    networks.add(network);
    return save(
        new StargateStore.Snapshot(networks, current.gates()), () -> store.createNetwork(network));
  }

  public CompletableFuture<Void> createGate(Stargate gate) {
    var current = current();
    var gates = new ArrayList<>(current.gates());
    gates.add(gate);
    return save(
        new StargateStore.Snapshot(current.networks(), gates), () -> store.createGate(gate));
  }

  public CompletableFuture<Void> replaceInvitations(UUID id, Set<UUID> players) {
    var current = current();
    var invited = Set.copyOf(players);
    var networks = new ArrayList<>(current.networks());
    var index = -1;
    for (var i = 0; i < networks.size(); i++) {
      if (networks.get(i).id().equals(id)) index = i;
    }
    if (index < 0
        || !(networks.get(index).access() instanceof NetworkAccess.Private(var owner, _))) {
      throw new IllegalArgumentException("not a private Stargate network: " + id);
    }
    var old = networks.get(index);
    networks.set(
        index, new StargateNetwork(id, old.name(), new NetworkAccess.Private(owner, invited)));
    return save(
        new StargateStore.Snapshot(networks, current.gates()),
        () -> store.replaceInvitations(id, invited));
  }

  public CompletableFuture<Void> deleteGate(UUID id) {
    var current = current();
    var gates = new ArrayList<>(current.gates());
    if (!gates.removeIf(gate -> gate.id().equals(id))) {
      throw new IllegalArgumentException("unknown Stargate: " + id);
    }
    return save(
        new StargateStore.Snapshot(current.networks(), gates),
        () ->
            store
                .deleteGate(id)
                .thenApply(
                    removed -> {
                      if (!removed)
                        throw new IllegalStateException("stored Stargate vanished: " + id);
                      return null;
                    }));
  }

  /** Remove an account's gates, invitations and owned private networks atomically. */
  public CompletableFuture<Void> resetPlayer(UUID player) {
    var current = current();
    var removedNetworks =
        current.networks().stream()
            .filter(
                network ->
                    network.access() instanceof NetworkAccess.Private(var owner, _)
                        && owner.equals(player))
            .map(StargateNetwork::id)
            .collect(java.util.stream.Collectors.toUnmodifiableSet());
    var networks =
        current.networks().stream()
            .filter(network -> !removedNetworks.contains(network.id()))
            .map(
                network -> {
                  if (!(network.access() instanceof NetworkAccess.Private(var owner, var invited)))
                    return network;
                  var remaining = new java.util.HashSet<>(invited);
                  remaining.remove(player);
                  return new StargateNetwork(
                      network.id(), network.name(), new NetworkAccess.Private(owner, remaining));
                })
            .toList();
    var gates =
        current.gates().stream()
            .filter(
                gate ->
                    !gate.ownerId().equals(player) && !removedNetworks.contains(gate.networkId()))
            .toList();
    return save(new StargateStore.Snapshot(networks, gates), () -> store.resetPlayer(player));
  }

  private StargateStore.Snapshot current() {
    if (!ready()) throw new IllegalStateException("Stargates are loading or saving");
    return java.util.Objects.requireNonNull(snapshot);
  }

  private CompletableFuture<Void> save(
      StargateStore.Snapshot next, Supplier<CompletableFuture<Void>> write) {
    var validated = new StargateRegistry(next);
    busy = true;
    CompletableFuture<Void> pending;
    try {
      pending = write.get();
    } catch (RuntimeException failure) {
      busy = false;
      throw failure;
    }
    return pending.handleAsync(
        (ignored, failure) -> {
          try {
            if (failure != null) throw new CompletionException(failure);
            snapshot = next;
            registry = validated;
            return null;
          } finally {
            busy = false;
          }
        },
        mainThread);
  }
}
