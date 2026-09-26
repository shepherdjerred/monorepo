package com.shepherdjerred.thestorm.qol.app;

import com.shepherdjerred.thestorm.qol.domain.grave.Grave;
import com.shepherdjerred.thestorm.qol.domain.grave.GraveContents;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePos;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * The graves in memory, mirroring storage, with a lock per grave so two players (or a player and
 * the expiry sweep) never work on the same grave at once. Main thread only.
 */
public final class GraveRegistry {

  private final Map<UUID, GraveContents> byId = new HashMap<>();
  private final Map<GravePos, UUID> byPos = new HashMap<>();
  private final Set<UUID> busy = new HashSet<>();
  private final Set<GravePos> reserved = new HashSet<>();
  private boolean loaded;

  /** Replaces everything with what storage holds. */
  public void load(Collection<GraveContents> graves) {
    byId.clear();
    byPos.clear();
    graves.forEach(this::put);
    loaded = true;
  }

  /** Whether storage has been read; until then no grave can be opened. */
  public boolean isLoaded() {
    return loaded;
  }

  /** Adds or replaces a grave. */
  public void put(GraveContents contents) {
    var grave = contents.grave();
    var previous = byId.put(grave.id(), contents);
    if (previous != null && !previous.grave().pos().equals(grave.pos())) {
      byPos.remove(previous.grave().pos());
    }
    byPos.put(grave.pos(), grave.id());
    reserved.remove(grave.pos());
  }

  public Optional<GraveContents> get(UUID id) {
    return Optional.ofNullable(byId.get(id));
  }

  public Optional<GraveContents> at(GravePos pos) {
    return Optional.ofNullable(byPos.get(pos)).map(byId::get);
  }

  /** Whether a grave stands, or is about to be placed, at {@code pos}. */
  public boolean isTaken(GravePos pos) {
    return byPos.containsKey(pos) || reserved.contains(pos);
  }

  /** Holds {@code pos} for a grave that is being saved. */
  public void reserve(GravePos pos) {
    reserved.add(pos);
  }

  /** Lets go of a reservation whose grave was not saved. */
  public void release(GravePos pos) {
    reserved.remove(pos);
  }

  /** {@code owner}'s graves, oldest first. */
  public List<Grave> ownedBy(UUID owner) {
    return byId.values().stream()
        .map(GraveContents::grave)
        .filter(grave -> grave.owner().equals(owner))
        .sorted(Comparator.comparing(Grave::createdAt))
        .toList();
  }

  /** Every grave, oldest first. */
  public List<GraveContents> all() {
    return byId.values().stream()
        .sorted(Comparator.comparing(contents -> contents.grave().createdAt()))
        .toList();
  }

  public void remove(UUID id) {
    var removed = byId.remove(id);
    if (removed != null) {
      byPos.remove(removed.grave().pos());
    }
    busy.remove(id);
  }

  /** Locks a grave for one operation; false if another is already running on it. */
  public boolean tryLock(UUID id) {
    return busy.add(id);
  }

  public void unlock(UUID id) {
    busy.remove(id);
  }
}
