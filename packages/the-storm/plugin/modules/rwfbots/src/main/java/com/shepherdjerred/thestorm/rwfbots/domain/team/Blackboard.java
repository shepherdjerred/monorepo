package com.shepherdjerred.thestorm.rwfbots.domain.team;

import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.random.RandomGenerator;

/**
 * What a team's bots know together. Sightings arrive late and sometimes not at all, depending on
 * the team's coordination lever, so weaker teams play with worse information rather than worse aim
 * alone.
 *
 * @param team whose board
 * @param strategy the round's strategy
 * @param sightings the latest shared sighting of each enemy
 * @param roles the role each bot holds
 * @param claimedCover which bot holds which cover node
 * @param rolesAssignedTick when roles were last handed out, or -1
 */
public record Blackboard(
    TeamId team,
    Strategy strategy,
    Map<CombatantId, SharedSighting> sightings,
    Map<CombatantId, Role> roles,
    Map<CombatantId, Integer> claimedCover,
    long rolesAssignedTick) {

  /** The longest a sighting is delayed, at zero coordination, in ticks. */
  public static final int MAX_SHARE_DELAY_TICKS = 30;

  /** The chance a sighting is shared at all, at zero coordination. */
  public static final double MIN_SHARE_CHANCE = 0.4;

  public Blackboard {
    sightings = Map.copyOf(sightings);
    roles = Map.copyOf(roles);
    claimedCover = Map.copyOf(claimedCover);
  }

  public static Blackboard open(TeamId team, Strategy strategy) {
    return new Blackboard(team, strategy, Map.of(), Map.of(), Map.of(), -1);
  }

  /**
   * Adds {@code reports} seen at {@code now}. Each is shared with probability {@code
   * MIN_SHARE_CHANCE + (1 - MIN_SHARE_CHANCE) * coordination} and lands {@code (1 - coordination) *
   * MAX_SHARE_DELAY_TICKS} ticks later.
   */
  public Blackboard share(
      List<SharedSighting> reports, double coordination, long now, RandomGenerator random) {
    var chance = MIN_SHARE_CHANCE + (1 - MIN_SHARE_CHANCE) * coordination;
    var delay = Math.round((1 - coordination) * MAX_SHARE_DELAY_TICKS);
    var copy = new HashMap<>(sightings);
    for (var report : reports) {
      if (random.nextDouble() >= chance) {
        continue;
      }
      var delayed =
          new SharedSighting(
              report.enemy(),
              report.pos(),
              report.vel(),
              report.seenTick(),
              now + delay,
              report.reporter());
      var existing = copy.get(report.enemy());
      if (existing == null || existing.seenTick() <= delayed.seenTick()) {
        copy.put(report.enemy(), delayed);
      }
    }
    return new Blackboard(team, strategy, copy, roles, claimedCover, rolesAssignedTick);
  }

  /** Sightings teammates have heard about by {@code now}, newest first. */
  public List<SharedSighting> visibleSightings(long now) {
    return sightings.values().stream()
        .filter(sighting -> sighting.visibleAtTick() <= now)
        .sorted((a, b) -> Long.compare(b.seenTick(), a.seenTick()))
        .toList();
  }

  public Optional<SharedSighting> sightingOf(CombatantId enemy, long now) {
    return Optional.ofNullable(sightings.get(enemy)).filter(s -> s.visibleAtTick() <= now);
  }

  public Blackboard forget(CombatantId enemy) {
    if (!sightings.containsKey(enemy)) {
      return this;
    }
    var copy = new HashMap<>(sightings);
    copy.remove(enemy);
    return new Blackboard(team, strategy, copy, roles, claimedCover, rolesAssignedTick);
  }

  public Optional<Role> roleOf(CombatantId bot) {
    return Optional.ofNullable(roles.get(bot));
  }

  public Blackboard withRoles(Map<CombatantId, Role> newRoles, long now) {
    return new Blackboard(team, strategy, sightings, newRoles, claimedCover, now);
  }

  /** Teammates holding {@code role}. */
  public List<CombatantId> holders(Role role) {
    return roles.entrySet().stream()
        .filter(entry -> entry.getValue() == role)
        .map(Map.Entry::getKey)
        .sorted()
        .toList();
  }

  public Blackboard claimCover(CombatantId bot, int node) {
    var copy = new HashMap<>(claimedCover);
    copy.put(bot, node);
    return new Blackboard(team, strategy, sightings, roles, copy, rolesAssignedTick);
  }

  public Blackboard releaseCover(CombatantId bot) {
    if (!claimedCover.containsKey(bot)) {
      return this;
    }
    var copy = new HashMap<>(claimedCover);
    copy.remove(bot);
    return new Blackboard(team, strategy, sightings, roles, copy, rolesAssignedTick);
  }

  /** Whether some other bot already holds cover {@code node}. */
  public boolean isCoverClaimed(int node, CombatantId except) {
    return claimedCover.entrySet().stream()
        .anyMatch(entry -> entry.getValue() == node && !entry.getKey().equals(except));
  }
}
