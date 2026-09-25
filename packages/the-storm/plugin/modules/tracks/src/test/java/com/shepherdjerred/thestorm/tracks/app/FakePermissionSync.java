package com.shepherdjerred.thestorm.tracks.app;

import static java.util.concurrent.CompletableFuture.completedFuture;

import com.shepherdjerred.thestorm.tracks.domain.TrackGroups;
import com.shepherdjerred.thestorm.tracks.domain.TrackProgress;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Records the track groups each player was last given. */
public final class FakePermissionSync implements PermissionSync {

  private final Map<UUID, Set<String>> groups = new HashMap<>();
  private int declared;
  private int applied;
  private boolean fail;

  public synchronized Set<String> groupsOf(UUID player) {
    return groups.getOrDefault(player, Set.of());
  }

  public synchronized int declared() {
    return declared;
  }

  public synchronized int applied() {
    return applied;
  }

  /** Every later sync fails. */
  public synchronized void failFromNowOn() {
    fail = true;
  }

  @Override
  public synchronized CompletableFuture<Void> declareGroups() {
    declared++;
    return completedFuture(null);
  }

  @Override
  public synchronized CompletableFuture<Void> apply(UUID player, TrackProgress progress) {
    applied++;
    if (fail) {
      return CompletableFuture.failedFuture(new IllegalStateException("LuckPerms is down"));
    }
    groups.put(player, TrackGroups.memberships(progress));
    return completedFuture(null);
  }
}
