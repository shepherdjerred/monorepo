package com.shepherdjerred.thestorm.rwfbots.domain.team;

import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.random.RandomGenerator;

/**
 * Immutable role-distance requests; scoring consumes randomness only after ordered results arrive.
 */
final class RoleAssignment {
  private final TeamBrain.Dealing dealing;
  private final List<Slot> slots;
  private final List<CombatantView> bots;
  private final int[] targets;
  private final int[] rowOfBot;
  private final List<Integer> sources;

  RoleAssignment(TeamBrain.Dealing dealing, List<Slot> slots) {
    this.dealing = dealing;
    this.slots = List.copyOf(slots);
    bots = dealing.alive().stream().sorted((a, b) -> a.id().compareTo(b.id())).toList();
    var graph = dealing.situation().nav().graph();
    targets = new int[slots.size()];
    for (var j = 0; j < slots.size(); j++) {
      targets[j] = graph.nearestNodeWithin(slots.get(j).pos(), 3).orElse(-1);
    }
    rowOfBot = new int[bots.size()];
    Arrays.fill(rowOfBot, -1);
    var rows = new HashMap<Integer, Integer>();
    var distinct = new ArrayList<Integer>();
    for (var i = 0; i < bots.size(); i++) {
      var from = graph.nearestNodeWithin(bots.get(i).pos(), 2);
      if (from.isEmpty()) continue;
      var source = from.getAsInt();
      var row = rows.get(source);
      if (row == null) {
        row = distinct.size();
        rows.put(source, row);
        distinct.add(source);
      }
      rowOfBot[i] = row;
    }
    sources = List.copyOf(distinct);
  }

  int rows() {
    return sources.size();
  }

  float[] distances(int row, NavGraph.SearchWorkspace workspace) {
    return dealing
        .situation()
        .nav()
        .graph()
        .cappedCostsToTargets(sources.get(row), targets, (float) TeamBrain.DISTANCE_CAP, workspace);
  }

  Map<CombatantId, String> finish(List<float[]> distances, RandomGenerator random) {
    if (distances.size() != rows()
        || distances.stream().anyMatch(row -> row.length != slots.size())) {
      throw new IllegalArgumentException("role-distance matrix does not match the prepared deal");
    }
    var profit = new double[bots.size()][slots.size()];
    for (var i = 0; i < bots.size(); i++) {
      var bot = bots.get(i);
      for (var j = 0; j < slots.size(); j++) {
        var distance = distance(i, j, distances);
        var erratic =
            dealing.situation().memberOf(bot.id()).archetype() == Archetype.TROLL
                ? TeamBrain.ERRATIC * random.nextDouble()
                : 0;
        profit[i][j] = TeamBrain.profit(dealing, bot, slots.get(j), distance) + erratic;
      }
    }
    var columns = Hungarian.maximize(profit);
    var result = new HashMap<CombatantId, String>();
    for (var i = 0; i < bots.size(); i++) result.put(bots.get(i).id(), slots.get(columns[i]).key());
    return result;
  }

  private double distance(int bot, int slot, List<float[]> distances) {
    var row = rowOfBot[bot];
    if (row >= 0 && Float.isFinite(distances.get(row)[slot])) return distances.get(row)[slot];
    return bots.get(bot).pos().horizontalDistance(slots.get(slot).pos()) * 2;
  }
}
