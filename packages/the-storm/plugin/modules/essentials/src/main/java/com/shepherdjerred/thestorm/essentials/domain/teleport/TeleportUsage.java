package com.shepherdjerred.thestorm.essentials.domain.teleport;

import java.time.Instant;
import java.util.EnumMap;
import java.util.Map;

/** One cooldown per teleport kind, recorded only after a successful arrival. */
public record TeleportUsage(Map<TeleportKind, Instant> cooldownUntil) {
  public static final TeleportUsage EMPTY = new TeleportUsage(Map.of());

  public TeleportUsage {
    cooldownUntil = Map.copyOf(cooldownUntil);
  }

  public Instant until(TeleportKind kind) {
    return cooldownUntil.getOrDefault(kind, Instant.EPOCH);
  }

  /** Keeps the later of the stored cooldown and {@code until}. */
  public TeleportUsage with(TeleportKind kind, Instant until) {
    var next = new EnumMap<TeleportKind, Instant>(TeleportKind.class);
    next.putAll(cooldownUntil);
    var existing = next.get(kind);
    if (existing == null || until.isAfter(existing)) {
      next.put(kind, until);
    }
    return new TeleportUsage(next);
  }
}
