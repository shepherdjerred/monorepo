// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/managers/GameManager.java,
// balanceTeams/assignTeam/getSmallestTeam); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.match;

import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.random.RandomGenerator;

/**
 * Puts players on teams as the match freezes, in Red Warfare's order: anyone an operator placed
 * goes to that team; then the kits that asked to be spread evenly (Red Warfare's {@code
 * isBalancedTeams}, such as Medic) are dealt one at a time to the team holding fewest of them; then
 * everyone else, in join order, goes to the smallest team, ties broken at random. Filling in order
 * keeps every pair of teams within one player of each other unless an operator pinned players.
 */
public final class TeamBalancer {

  private TeamBalancer() {}

  /**
   * A player waiting for a team.
   *
   * @param id who
   * @param kit their kit, if picked
   * @param pinned the team an operator placed them on, if any
   */
  public record Seat(CombatantId id, Optional<String> kit, Optional<TeamColor> pinned) {}

  /** Team for every player, in the order given, with no kits to spread and nobody pinned. */
  public static Map<CombatantId, TeamColor> assign(
      List<CombatantId> joinOrder, List<TeamColor> teams, RandomGenerator random) {
    return assign(
        joinOrder.stream().map(id -> new Seat(id, Optional.empty(), Optional.empty())).toList(),
        teams,
        Set.of(),
        random);
  }

  /** Team for every seat, spreading the holders of {@code spreadKits} first. */
  public static Map<CombatantId, TeamColor> assign(
      List<Seat> seats, List<TeamColor> teams, Set<String> spreadKits, RandomGenerator random) {
    if (teams.isEmpty()) {
      throw new IllegalArgumentException("a map needs teams");
    }
    var sizes = new EnumMap<TeamColor, Integer>(TeamColor.class);
    var spread = new EnumMap<TeamColor, Integer>(TeamColor.class);
    teams.forEach(
        team -> {
          sizes.put(team, 0);
          spread.put(team, 0);
        });
    var assignment = new LinkedHashMap<CombatantId, TeamColor>();
    for (var seat : seats) {
      seat.pinned()
          .filter(teams::contains)
          .ifPresent(
              team -> {
                assignment.put(seat.id(), team);
                sizes.merge(team, 1, Integer::sum);
                if (spreads(seat, spreadKits)) {
                  spread.merge(team, 1, Integer::sum);
                }
              });
    }
    for (var seat : seats) {
      if (assignment.containsKey(seat.id()) || !spreads(seat, spreadKits)) {
        continue;
      }
      var candidates = smallest(smallest(teams, spread), sizes);
      var team = candidates.get(random.nextInt(candidates.size()));
      assignment.put(seat.id(), team);
      sizes.merge(team, 1, Integer::sum);
      spread.merge(team, 1, Integer::sum);
    }
    for (var seat : seats) {
      if (assignment.containsKey(seat.id())) {
        continue;
      }
      var smallest = smallest(teams, sizes);
      var team = smallest.get(random.nextInt(smallest.size()));
      sizes.merge(team, 1, Integer::sum);
      assignment.put(seat.id(), team);
    }
    var ordered = new LinkedHashMap<CombatantId, TeamColor>();
    for (var seat : seats) {
      ordered.put(seat.id(), assignment.get(seat.id()));
    }
    return ordered;
  }

  private static boolean spreads(Seat seat, Set<String> spreadKits) {
    return seat.kit().filter(spreadKits::contains).isPresent();
  }

  private static List<TeamColor> smallest(List<TeamColor> teams, Map<TeamColor, Integer> sizes) {
    var min = teams.stream().mapToInt(team -> sizes.getOrDefault(team, 0)).min().orElseThrow();
    var smallest = new ArrayList<TeamColor>();
    for (var team : teams) {
      if (sizes.getOrDefault(team, 0) == min) {
        smallest.add(team);
      }
    }
    return smallest;
  }

  /** Whether no two teams differ by more than one player. */
  public static boolean balanced(Map<CombatantId, TeamColor> assignment, List<TeamColor> teams) {
    var sizes = new EnumMap<TeamColor, Integer>(TeamColor.class);
    teams.forEach(team -> sizes.put(team, 0));
    assignment.values().forEach(team -> sizes.merge(team, 1, Integer::sum));
    var stats = sizes.values().stream().mapToInt(Integer::intValue).summaryStatistics();
    return stats.getMax() - stats.getMin() <= 1;
  }
}
