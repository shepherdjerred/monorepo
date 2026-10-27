package com.shepherdjerred.thestorm.mechanics.app;

import com.shepherdjerred.thestorm.mechanics.domain.stargate.Stargate;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.StargateNetwork;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Persistent Stargate state; callers return to the main thread before using world state. */
public interface StargateStore {
  record Snapshot(List<StargateNetwork> networks, List<Stargate> gates) {
    public Snapshot {
      networks = List.copyOf(networks);
      gates = List.copyOf(gates);
    }
  }

  CompletableFuture<Snapshot> load();

  CompletableFuture<Void> createNetwork(StargateNetwork network);

  CompletableFuture<Void> replaceInvitations(UUID networkId, java.util.Set<UUID> players);

  CompletableFuture<Void> createGate(Stargate gate);

  CompletableFuture<Boolean> deleteGate(UUID id);
}
