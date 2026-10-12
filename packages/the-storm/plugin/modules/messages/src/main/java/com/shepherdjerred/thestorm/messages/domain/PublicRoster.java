package com.shepherdjerred.thestorm.messages.domain;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.function.Predicate;

/** Main-thread presence updates, with immutable public snapshots for Query's network thread. */
public final class PublicRoster {
  private final ConcurrentMap<UUID, String> humans = new ConcurrentHashMap<>();

  public void joined(UUID id, String name, boolean human) {
    if (human) humans.put(id, name);
    else humans.remove(id);
  }

  public void left(UUID id) {
    humans.remove(id);
  }

  public List<String> names(boolean restored, Predicate<UUID> hidden) {
    if (!restored) return List.of();
    return humans.entrySet().stream()
        .filter(entry -> !hidden.test(entry.getKey()))
        .map(java.util.Map.Entry::getValue)
        .sorted(String.CASE_INSENSITIVE_ORDER)
        .toList();
  }
}
