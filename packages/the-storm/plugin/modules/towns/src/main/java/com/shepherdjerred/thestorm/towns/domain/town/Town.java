package com.shepherdjerred.thestorm.towns.domain.town;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * A player town.
 *
 * @param id stable id
 * @param name unique (ignoring case) display name
 * @param createdAt when it was founded
 * @param members every member and their role; exactly one {@link TownRole#OWNER}
 */
public record Town(UUID id, String name, Instant createdAt, Map<UUID, TownRole> members) {

  public Town {
    members = Map.copyOf(members);
    var owners = members.values().stream().filter(role -> role == TownRole.OWNER).count();
    if (owners != 1) {
      throw new IllegalArgumentException(
          "town " + name + " must have exactly one owner, has " + owners);
    }
    if (!TownNames.isValid(name)) {
      throw new IllegalArgumentException("invalid town name: " + name);
    }
  }

  /** A new town with {@code founder} as its owner and only member. */
  public static Town found(UUID id, String name, Instant createdAt, UUID founder) {
    return new Town(id, name, createdAt, Map.of(founder, TownRole.OWNER));
  }

  public Optional<TownRole> roleOf(UUID player) {
    return Optional.ofNullable(members.get(player));
  }

  public UUID owner() {
    return members.entrySet().stream()
        .filter(entry -> entry.getValue() == TownRole.OWNER)
        .map(Map.Entry::getKey)
        .findFirst()
        .orElseThrow();
  }
}
