package com.shepherdjerred.thestorm.towns.domain.town;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * A player town or camp.
 *
 * @param id stable id
 * @param name unique (ignoring case) display name; a camp uses its founder's account name
 * @param createdAt when it was founded
 * @param members every member and role; one owner, or no members while in historical custody
 * @param governorLevel the owner's Governor level when last seen online (0 to {@link
 *     #MAX_GOVERNOR_LEVEL}), which sets how much land a town may hold while they are away
 * @param kind camp or town
 * @param lastActive when a camp member was last on the server; empty for a town
 * @param expiryWarned whether the camp's members have already been warned about this idle period
 * @param historicalCustody an archived town with an unidentified mayor, held without player members
 */
public record Town(
    UUID id,
    String name,
    Instant createdAt,
    Map<UUID, TownRole> members,
    int governorLevel,
    TownKind kind,
    Optional<Instant> lastActive,
    boolean expiryWarned,
    boolean historicalCustody) {

  /** The highest Governor level, matching the tracks module's highest level. */
  public static final int MAX_GOVERNOR_LEVEL = 5;

  /** Checks the member list, the name, the Governor level, and a camp's clock. */
  public Town {
    members = Map.copyOf(members);
    var owners = members.values().stream().filter(role -> role == TownRole.OWNER).count();
    if (historicalCustody && (!members.isEmpty() || governorLevel != 0 || kind != TownKind.TOWN)) {
      throw new IllegalArgumentException("staff-custody historical towns have no player members");
    }
    if (!historicalCustody && owners != 1) {
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
    if (kind == TownKind.CAMP && lastActive.isEmpty()) {
      throw new IllegalArgumentException("a camp records when a member was last seen");
    }
    if (kind == TownKind.TOWN && (lastActive.isPresent() || expiryWarned)) {
      throw new IllegalArgumentException("a town has no activity clock");
    }
  }

  /**
   * A new town with {@code founder} as its owner and only member, at Governor level 0 until {@link
   * #withGovernorLevel} records the founder's.
   */
  public static Town found(UUID id, String name, Instant createdAt, UUID founder) {
    return new Town(
        id,
        name,
        createdAt,
        Map.of(founder, TownRole.OWNER),
        0,
        TownKind.TOWN,
        Optional.empty(),
        false,
        false);
  }

  /** A recorded town whose mayor has not been identified. No player receives ownership. */
  public static Town historical(UUID id, String name, Instant createdAt) {
    return new Town(id, name, createdAt, Map.of(), 0, TownKind.TOWN, Optional.empty(), false, true);
  }

  /** A new camp named {@code name}, owned by {@code founder}, active as of {@code createdAt}. */
  public static Town camp(UUID id, String name, Instant createdAt, UUID founder) {
    return new Town(
        id,
        name,
        createdAt,
        Map.of(founder, TownRole.OWNER),
        0,
        TownKind.CAMP,
        Optional.of(createdAt),
        false,
        false);
  }

  public boolean isCamp() {
    return kind == TownKind.CAMP;
  }

  public Optional<TownRole> roleOf(UUID player) {
    return Optional.ofNullable(members.get(player));
  }

  public UUID owner() {
    return mayor()
        .orElseThrow(() -> new IllegalStateException("town mayor is unassigned: " + name));
  }

  /** Staff-custody historical towns have no player mayor. */
  public Optional<UUID> mayor() {
    return members.entrySet().stream()
        .filter(entry -> entry.getValue() == TownRole.OWNER)
        .map(Map.Entry::getKey)
        .findFirst();
  }

  /** A copy where {@code player} has {@code role}, joining if they were not a member. */
  public Town withMember(UUID player, TownRole role) {
    var next = new HashMap<>(members);
    next.put(player, role);
    return copy(name, next, governorLevel);
  }

  /** A copy without {@code player}. */
  public Town withoutMember(UUID player) {
    var next = new HashMap<>(members);
    next.remove(player);
    return copy(name, next, governorLevel);
  }

  /**
   * A copy owned by {@code member}, whose Governor level is {@code level}; the old owner stays on
   * as an assistant.
   */
  public Town transferredTo(UUID member, int level) {
    if (historicalCustody) {
      return new Town(
          id,
          name,
          createdAt,
          Map.of(member, TownRole.OWNER),
          level,
          TownKind.TOWN,
          Optional.empty(),
          false,
          false);
    }
    var next = new HashMap<>(members);
    next.put(owner(), TownRole.ASSISTANT);
    next.put(member, TownRole.OWNER);
    return copy(name, next, level);
  }

  public Town renamed(String newName) {
    return copy(newName, members, governorLevel);
  }

  public Town withGovernorLevel(int level) {
    return copy(name, members, level);
  }

  /** A camp whose idle clock starts at {@code at}. */
  public Town seen(Instant at) {
    if (!isCamp()) {
      throw new IllegalArgumentException("only a camp records activity");
    }
    return clock(Optional.of(at), false);
  }

  /** A camp whose members have been warned for the current idle period. */
  public Town warned() {
    if (!isCamp()) {
      throw new IllegalArgumentException("only a camp warns about expiry");
    }
    return clock(lastActive, true);
  }

  /** This camp as a town named {@code newName}, owned at Governor {@code level}. */
  public Town graduated(String newName, int level) {
    if (!isCamp()) {
      throw new IllegalArgumentException("only a camp graduates");
    }
    return new Town(
        id, newName, createdAt, members, level, TownKind.TOWN, Optional.empty(), false, false);
  }

  private Town copy(String nextName, Map<UUID, TownRole> nextMembers, int level) {
    return new Town(
        id,
        nextName,
        createdAt,
        nextMembers,
        level,
        kind,
        lastActive,
        expiryWarned,
        historicalCustody);
  }

  private Town clock(Optional<Instant> active, boolean warned) {
    return new Town(id, name, createdAt, members, governorLevel, kind, active, warned, false);
  }
}
