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

  public List<Player> players(boolean restored, Predicate<UUID> hidden) {
    if (!restored) return List.of();
    return humans.entrySet().stream()
        .filter(entry -> !hidden.test(entry.getKey()))
        .map(entry -> new Player(entry.getValue(), entry.getKey()))
        .sorted(java.util.Comparator.comparing(Player::name, String.CASE_INSENSITIVE_ORDER))
        .toList();
  }

  public List<String> names(boolean restored, Predicate<UUID> hidden) {
    return players(restored, hidden).stream().map(Player::name).toList();
  }

  public record Player(String name, UUID uuid) {}
}
