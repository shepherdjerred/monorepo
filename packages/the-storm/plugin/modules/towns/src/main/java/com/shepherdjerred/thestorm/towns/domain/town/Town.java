package com.shepherdjerred.thestorm.towns.domain.town;

import java.time.Instant;
import java.util.HashMap;
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
 * @param governorLevel the owner's Governor level when last seen online (0 to {@link
 *     #MAX_GOVERNOR_LEVEL}), which sets how much land the town may hold while they are away
 */
public record Town(
    UUID id, String name, Instant createdAt, Map<UUID, TownRole> members, int governorLevel) {

  /** The highest Governor level, matching the tracks module's highest level. */
  public static final int MAX_GOVERNOR_LEVEL = 5;

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
    if (governorLevel < 0 || governorLevel > MAX_GOVERNOR_LEVEL) {
      throw new IllegalArgumentException(
          "governor level must be 0.." + MAX_GOVERNOR_LEVEL + ": " + governorLevel);
    }
  }

  /**
   * A new town with {@code founder} as its owner and only member, at Governor level 0 until {@link
   * #withGovernorLevel} records the founder's.
   */
  public static Town found(UUID id, String name, Instant createdAt, UUID founder) {
    return new Town(id, name, createdAt, Map.of(founder, TownRole.OWNER), 0);
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

  /** A copy where {@code player} has {@code role}, joining if they were not a member. */
  public Town withMember(UUID player, TownRole role) {
    var next = new HashMap<>(members);
    next.put(player, role);
    return new Town(id, name, createdAt, next, governorLevel);
  }

  /** A copy without {@code player}. */
  public Town withoutMember(UUID player) {
    var next = new HashMap<>(members);
    next.remove(player);
    return new Town(id, name, createdAt, next, governorLevel);
  }

  /**
   * A copy owned by {@code member}, whose Governor level is {@code level}; the old owner stays on
   * as an assistant.
   */
  public Town transferredTo(UUID member, int level) {
    var next = new HashMap<>(members);
    next.put(owner(), TownRole.ASSISTANT);
    next.put(member, TownRole.OWNER);
    return new Town(id, name, createdAt, next, level);
  }

  public Town renamed(String newName) {
    return new Town(id, newName, createdAt, members, governorLevel);
  }

  public Town withGovernorLevel(int level) {
    return new Town(id, name, createdAt, members, level);
  }
}
