package com.shepherdjerred.thestorm.towns.app;

import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import com.shepherdjerred.thestorm.towns.domain.land.Claim;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Keeps saved towns and claims. Each write waits until the test completes it: success applies it to
 * what is saved, failure leaves that untouched. Reloads complete at once unless held.
 */
final class FakeTownsStore implements TownsStore {

  private final Map<UUID, Town> towns = new LinkedHashMap<>();
  private final Map<ChunkPos, Claim> claims = new LinkedHashMap<>();
  private final List<Write> pending = new ArrayList<>();
  private boolean holdReload;
  private CompletableFuture<TownsSnapshot> heldReload = new CompletableFuture<>();

  private record Write(Runnable apply, CompletableFuture<Void> done) {}

  void seed(Town town, Claim... held) {
    towns.put(town.id(), town);
    for (var claim : held) {
      claims.put(claim.chunk(), claim);
    }
  }

  TownsSnapshot snapshot() {
    return new TownsSnapshot(List.copyOf(towns.values()), List.copyOf(claims.values()));
  }

  int pending() {
    return pending.size();
  }

  private CompletableFuture<Void> record(Runnable apply) {
    var done = new CompletableFuture<Void>();
    pending.add(new Write(apply, done));
    return done;
  }

  void succeed() {
    var write = pending.removeFirst();
    write.apply().run();
    write.done().complete(null);
  }

  /** Completes every outstanding write successfully, in order. */
  void succeedAll() {
    while (!pending.isEmpty()) {
      succeed();
    }
  }

  void fail() {
    pending.removeFirst().done().completeExceptionally(new IllegalStateException("disk full"));
  }

  void failAndHoldReload() {
    holdReload = true;
    fail();
  }

  void finishReload() {
    heldReload.complete(snapshot());
  }

  void failReload() {
    heldReload.completeExceptionally(new IllegalStateException("database gone"));
  }

  @Override
  public CompletableFuture<TownsSnapshot> loadAll() {
    if (holdReload) {
      heldReload = new CompletableFuture<>();
      return heldReload;
    }
    return CompletableFuture.completedFuture(snapshot());
  }

  @Override
  public CompletableFuture<Void> createTown(Town town) {
    return record(() -> towns.put(town.id(), town));
  }

  @Override
  public CompletableFuture<Void> saveTown(Town town) {
    return record(() -> towns.put(town.id(), town));
  }

  @Override
  public CompletableFuture<Set<UUID>> saveDeparture(Town town, UUID departed) {
    return record(() -> towns.put(town.id(), town)).thenApply(done -> Set.of());
  }

  @Override
  public CompletableFuture<Void> deleteTown(UUID townId) {
    return record(
        () -> {
          towns.remove(townId);
          var remaining = new HashMap<>(claims);
          remaining.values().removeIf(claim -> claim.townId().equals(townId));
          claims.clear();
          claims.putAll(remaining);
        });
  }

  @Override
  public CompletableFuture<Void> addClaim(Claim claim, Instant at) {
    return record(() -> claims.put(claim.chunk(), claim));
  }

  @Override
  public CompletableFuture<Void> removeClaim(ChunkPos chunk) {
    return record(() -> claims.remove(chunk));
  }

  @Override
  public CompletableFuture<Void> saveClaim(Claim claim) {
    return record(() -> claims.put(claim.chunk(), claim));
  }
}
