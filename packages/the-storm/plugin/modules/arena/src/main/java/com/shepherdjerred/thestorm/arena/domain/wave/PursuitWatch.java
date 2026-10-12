package com.shepherdjerred.thestorm.arena.domain.wave;

import com.shepherdjerred.thestorm.arena.domain.geometry.Point;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Detects stalled pursuit using elapsed time; mobs already fighting do not need recovery. */
public final class PursuitWatch {
  private record Position(Point at, Instant movedAt) {}

  private final Map<UUID, Position> positions = new HashMap<>();

  public enum Action {
    NONE,
    RETRY,
    RELOCATE
  }

  public Action observe(UUID id, Point at, Instant now, boolean fighting) {
    var previous = positions.get(id);
    if (fighting || previous == null || previous.at().distance(at) >= 0.5) {
      positions.put(id, new Position(at, now));
      return Action.NONE;
    }
    if (!now.isBefore(previous.movedAt().plusSeconds(20))) {
      positions.remove(id);
      return Action.RELOCATE;
    }
    return now.isBefore(previous.movedAt().plusSeconds(5)) ? Action.NONE : Action.RETRY;
  }

  public void retain(Set<UUID> alive) {
    positions.keySet().retainAll(alive);
  }

  public void reset() {
    positions.clear();
  }
}
