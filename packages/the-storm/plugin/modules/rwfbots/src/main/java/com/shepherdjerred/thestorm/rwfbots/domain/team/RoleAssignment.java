package com.shepherdjerred.thestorm.rwfbots.domain.team;

import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Hands out role slots to bots so the summed utility is as large as possible, with the Hungarian
 * algorithm. Every bot gets exactly one slot; with more slots than bots the worst slots go unused.
 */
public final class RoleAssignment {

  private RoleAssignment() {}

  /**
   * The role of every bot.
   *
   * @param utilities how much each bot wants each role; a role missing for a bot scores zero
   * @param slots the roles on offer, at least one per bot
   */
  public static Map<CombatantId, Role> assign(
      Map<CombatantId, Map<Role, Double>> utilities, List<Role> slots) {
    var bots = utilities.keySet().stream().sorted().toList();
    if (bots.isEmpty()) {
      return Map.of();
    }
    if (slots.size() < bots.size()) {
      throw new IllegalArgumentException("every bot needs a slot");
    }
    var profit = new double[bots.size()][slots.size()];
    for (var i = 0; i < bots.size(); i++) {
      var wants = utilities.getOrDefault(bots.get(i), Map.of());
      for (var j = 0; j < slots.size(); j++) {
        profit[i][j] = wants.getOrDefault(slots.get(j), 0.0);
      }
    }
    var columns = Hungarian.maximize(profit);
    var result = new HashMap<CombatantId, Role>();
    for (var i = 0; i < bots.size(); i++) {
      result.put(bots.get(i), slots.get(columns[i]));
    }
    return Map.copyOf(result);
  }
}
