package com.shepherdjerred.thestorm.creative.app;

import com.shepherdjerred.thestorm.creative.domain.BodyRole;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Survival bodies held in memory for the open visit. The creative body is not held here: a clean
 * leave discards it, and a crash reads it back from storage.
 */
public final class VisitBook {

  public static final VisitBook EMPTY = new VisitBook(Map.of());

  private final Map<UUID, VisitBody> survival;

  private VisitBook(Map<UUID, VisitBody> survival) {
    this.survival = survival;
  }

  public Optional<VisitBody> survival(UUID player) {
    return Optional.ofNullable(survival.get(player));
  }

  public boolean inside(UUID player) {
    return survival.containsKey(player);
  }

  /** Remembers {@code body}. Only a survival body may be held. */
  public VisitBook hold(VisitBody body) {
    if (body.role() != BodyRole.SURVIVAL) {
      throw new IllegalArgumentException("only the survival body is held in memory");
    }
    var next = new HashMap<>(survival);
    next.put(body.snapshot().player(), body);
    return new VisitBook(Map.copyOf(next));
  }

  public VisitBook drop(UUID player) {
    if (!survival.containsKey(player)) {
      return this;
    }
    var next = new HashMap<>(survival);
    next.remove(player);
    return new VisitBook(Map.copyOf(next));
  }
}
