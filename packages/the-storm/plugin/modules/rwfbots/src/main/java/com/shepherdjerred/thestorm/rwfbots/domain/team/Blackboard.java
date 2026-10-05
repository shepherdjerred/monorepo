package com.shepherdjerred.thestorm.rwfbots.domain.team;

import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Predicate;
import java.util.random.RandomGenerator;

/**
 * What a team's bots know together. Sightings arrive late and sometimes not at all, depending on
 * the team's coordination lever, so weaker teams play with worse information rather than worse aim
 * alone. The board also carries the playbook's slots and who holds them, and what each bot last
 * told the team: the cover it claimed, the enemy it chases and the path it walks.
 *
 * @param team whose board
 * @param strategy the round's strategy
 * @param sightings the latest shared sighting of each enemy
 * @param roles the role each bot holds
 * @param claimedCover which bot holds which cover node
 * @param rolesAssignedTick when roles were last handed out, or -1
 * @param plan the playbook's slots and their holders
 * @param chasing which enemy each bot is fighting
 * @param paths the nav nodes each bot is about to walk
 */
public record Blackboard(
    TeamId team,
    Strategy strategy,
    Map<CombatantId, SharedSighting> sightings,
    Map<CombatantId, Role> roles,
    Map<CombatantId, Integer> claimedCover,
    long rolesAssignedTick,
    TeamPlan plan,
    Map<CombatantId, CombatantId> chasing,
    Map<CombatantId, Set<Integer>> paths) {

  /** The longest a sighting is delayed, at zero coordination, in ticks. */
  public static final int MAX_SHARE_DELAY_TICKS = 30;

  /** The chance a sighting is shared at all, at zero coordination. */
  public static final double MIN_SHARE_CHANCE = 0.4;

  public Blackboard {
    sightings = Map.copyOf(sightings);
    roles = Map.copyOf(roles);
    claimedCover = Map.copyOf(claimedCover);
    chasing = Map.copyOf(chasing);
    var copiedPaths = new HashMap<CombatantId, Set<Integer>>();
    paths.forEach((bot, nodes) -> copiedPaths.put(bot, Set.copyOf(nodes)));
    paths = Map.copyOf(copiedPaths);
  }

  public static Blackboard open(TeamId team, Strategy strategy) {
    return new Blackboard(
        team, strategy, Map.of(), Map.of(), Map.of(), -1, TeamPlan.NONE, Map.of(), Map.of());
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
    return new Blackboard(
        team, strategy, copy, roles, claimedCover, rolesAssignedTick, plan, chasing, paths);
  }

  /**
   * Sightings teammates have heard about by {@code now}, newest first, then by enemy, so the order
   * never depends on how the map happens to iterate.
   */
  public List<SharedSighting> visibleSightings(long now) {
    return sightings.values().stream()
        .filter(sighting -> sighting.visibleAtTick() <= now)
        .sorted(
            Comparator.comparingLong(SharedSighting::seenTick)
                .reversed()
                .thenComparing(SharedSighting::enemy))
        .toList();
  }

  public Optional<SharedSighting> sightingOf(CombatantId enemy, long now) {
    return Optional.ofNullable(sightings.get(enemy)).filter(s -> s.visibleAtTick() <= now);
  }

  /** Forgets everything about {@code enemy}: its sighting and who was chasing it. */
  public Blackboard forget(CombatantId enemy) {
    if (!sightings.containsKey(enemy) && !chasing.containsValue(enemy)) {
      return this;
    }
    var copy = new HashMap<>(sightings);
    copy.remove(enemy);
    var chases = new HashMap<>(chasing);
    chases.values().removeIf(enemy::equals);
    return new Blackboard(
        team, strategy, copy, roles, claimedCover, rolesAssignedTick, plan, chases, paths);
  }

  /** Drops the claims, chases and paths of teammates for whom {@code gone} holds. */
  public Blackboard dropNotes(Predicate<CombatantId> gone) {
    var cover = new HashMap<>(claimedCover);
    var chases = new HashMap<>(chasing);
    var walking = new HashMap<>(paths);
    cover.keySet().removeIf(gone);
    chases.keySet().removeIf(gone);
    walking.keySet().removeIf(gone);
    if (cover.size() == claimedCover.size()
        && chases.size() == chasing.size()
        && walking.size() == paths.size()) {
      return this;
    }
    return new Blackboard(
        team, strategy, sightings, roles, cover, rolesAssignedTick, plan, chases, walking);
  }

  public Optional<Role> roleOf(CombatantId bot) {
    return Optional.ofNullable(roles.get(bot));
  }

  public Blackboard withRoles(Map<CombatantId, Role> newRoles, long now) {
    return new Blackboard(
        team, strategy, sightings, newRoles, claimedCover, now, plan, chasing, paths);
  }

  /** A new deal: the plan and the roles its slots carry. */
  public Blackboard withPlan(TeamPlan newPlan, long now) {
    var newRoles = new HashMap<CombatantId, Role>();
    newPlan
        .assignment()
        .forEach((bot, key) -> newRoles.put(bot, newPlan.slot(key).orElseThrow().role()));
    return new Blackboard(
        team, strategy, sightings, newRoles, claimedCover, now, newPlan, chasing, paths);
  }

  /** The slot {@code bot} holds, if the playbook has dealt it one. */
  public Optional<Slot> slotOf(CombatantId bot) {
    return plan.slotOf(bot);
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
    return new Blackboard(
        team, strategy, sightings, roles, copy, rolesAssignedTick, plan, chasing, paths);
  }

  public Blackboard releaseCover(CombatantId bot) {
    if (!claimedCover.containsKey(bot)) {
      return this;
    }
    var copy = new HashMap<>(claimedCover);
    copy.remove(bot);
    return new Blackboard(
        team, strategy, sightings, roles, copy, rolesAssignedTick, plan, chasing, paths);
  }

  /** Whether some other bot already holds cover {@code node}. */
  public boolean isCoverClaimed(int node, CombatantId except) {
    return claimedCover.entrySet().stream()
        .anyMatch(entry -> entry.getValue() == node && !entry.getKey().equals(except));
  }

  /** Records what {@code bot} told the team: claims or releases cover, chase and path. */
  public Blackboard note(CombatantId bot, TeamNote note) {
    var cover = new HashMap<>(claimedCover);
    var chases = new HashMap<>(chasing);
    var walking = new HashMap<>(paths);
    note.cover().ifPresentOrElse(node -> cover.put(bot, node), () -> cover.remove(bot));
    note.chasing().ifPresentOrElse(enemy -> chases.put(bot, enemy), () -> chases.remove(bot));
    if (note.path().isEmpty()) {
      walking.remove(bot);
    } else {
      walking.put(bot, note.path());
    }
    return new Blackboard(
        team, strategy, sightings, roles, cover, rolesAssignedTick, plan, chases, walking);
  }

  /** How many teammates other than {@code except} are fighting {@code enemy}. */
  public int chasers(CombatantId enemy, CombatantId except) {
    return (int)
        chasing.entrySet().stream()
            .filter(entry -> entry.getValue().equals(enemy) && !entry.getKey().equals(except))
            .count();
  }

  /** The nav nodes teammates other than {@code except} are about to walk. */
  public Set<Integer> pathsOfOthers(CombatantId except) {
    var out = new HashSet<Integer>();
    paths.forEach(
        (bot, nodes) -> {
          if (!bot.equals(except)) {
            out.addAll(nodes);
          }
        });
    return out;
  }
}
