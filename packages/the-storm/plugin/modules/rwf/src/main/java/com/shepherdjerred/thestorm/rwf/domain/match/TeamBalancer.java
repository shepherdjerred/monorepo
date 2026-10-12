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
import java.util.random.RandomGenerator;

/**
 * Puts players on teams as the match starts: each player, in join order, goes to the smallest team,
 * ties broken at random. Filling in order keeps every pair of teams within one player of each
 * other, so Red Warfare's follow-up pass that moved the latest joiner off an oversized team never
 * fires. (Kits that asked to be spread evenly, such as Medic, are a milestone-2 concern; see
 * KITS.md.)
 */
public final class TeamBalancer {

  private TeamBalancer() {}

  /** Team for every player, in the order given. */
  public static Map<CombatantId, TeamColor> assign(
      List<CombatantId> joinOrder, List<TeamColor> teams, RandomGenerator random) {
    if (teams.isEmpty()) {
      throw new IllegalArgumentException("a map needs teams");
    }
    var sizes = new EnumMap<TeamColor, Integer>(TeamColor.class);
    teams.forEach(team -> sizes.put(team, 0));
    var assignment = new LinkedHashMap<CombatantId, TeamColor>();
    for (var player : joinOrder) {
      var smallest = smallest(teams, sizes);
      var team = smallest.get(random.nextInt(smallest.size()));
      sizes.merge(team, 1, Integer::sum);
      assignment.put(player, team);
    }
    return assignment;
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
