package com.shepherdjerred.thestorm.rwfbots.domain.team;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwfbots.domain.Fixtures;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.MapBaker;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

final class RoleAssignmentTest {
  @Test
  void completeAssignmentsAndRemainingRandomnessMatchFullUncappedForwardSearches() {
    var random = new SplittableRandom(196);
    for (var open : new boolean[] {true, false}) {
      var nav = MapBaker.bake("assignment", new SyntheticMap(open), SyntheticMap.sites());
      for (var sample = 0; sample < 30; sample++) compareAssignment(nav, random, sample);
    }
  }

  private static void compareAssignment(NavArtifact nav, SplittableRandom random, int sample) {
    var graph = nav.graph();
    var bots = new ArrayList<CombatantView>();
    var slots = new ArrayList<Slot>();
    var members = new HashMap<CombatantId, SlotFit.Member>();
    for (var i = 0; i < 8; i++) {
      var position = i == 1 ? bots.getFirst().pos() : graph.feet(random.nextInt(graph.nodeCount()));
      if (i == 7) position = new Vec3(-100, 1, -100);
      var bot = Fixtures.combatant(8 - i, RED, position);
      bots.add(bot);
      members.put(
          bot.id(),
          new SlotFit.Member(
              i % 3 == 0 ? Archetype.TROLL : Archetype.TACTICIAN,
              Set.of(),
              Map.of(Role.ROTATE, 1.0, Role.DEFEND, 0.7),
              Kit.TROOPER));
      var target = i == 7 ? new Vec3(-200, 1, -200) : graph.feet(random.nextInt(graph.nodeCount()));
      slots.add(
          new Slot(
              "slot-" + i,
              SlotKind.LANE,
              Role.ROTATE,
              target,
              target,
              -1,
              -1,
              Optional.empty(),
              0));
    }
    var snapshot =
        new WorldSnapshot(
            sample,
            MatchPhase.LIVE,
            bots,
            List.of(),
            PoisonView.NONE,
            nav.mapId(),
            List.of(),
            List.of(),
            List.of());
    var previous =
        new TeamPlan(
            Optional.of(Strategy.RUSH),
            Optional.empty(),
            Optional.empty(),
            List.of(),
            0,
            slots,
            Map.of(bots.getFirst().id(), slots.getFirst().key()),
            0,
            Map.of(),
            -1);
    var dealing =
        new TeamBrain.Dealing(
            previous,
            new TeamBrain.TeamSituation(nav, snapshot, bots, members),
            bots,
            false,
            java.util.Set.of());
    var prepared = new RoleAssignment(dealing, slots);
    assertThat(prepared.rows()).isLessThan(bots.size());
    var rows = new ArrayList<float[]>();
    for (var row = 0; row < prepared.rows(); row++) rows.add(new float[0]);
    // Deliberately finish distance rows in reverse; scoring receives canonical row order.
    for (var row = prepared.rows() - 1; row >= 0; row--)
      rows.set(row, prepared.distances(row, graph.workspace()));
    var actualRandom = new SplittableRandom(sample);
    var expectedRandom = new SplittableRandom(sample);
    assertThat(prepared.finish(rows, actualRandom))
        .isEqualTo(reference(dealing, slots, expectedRandom));
    assertThat(actualRandom.nextLong()).isEqualTo(expectedRandom.nextLong());
    assertThatThrownBy(() -> prepared.finish(List.of(), actualRandom))
        .isInstanceOf(IllegalArgumentException.class);
  }

  /** Original scoring order, with full forward Dijkstra rather than the capped query API. */
  private static Map<CombatantId, String> reference(
      TeamBrain.Dealing dealing, List<Slot> slots, SplittableRandom random) {
    var graph = dealing.situation().nav().graph();
    var bots = dealing.alive().stream().sorted((a, b) -> a.id().compareTo(b.id())).toList();
    var profit = new double[bots.size()][slots.size()];
    for (var i = 0; i < bots.size(); i++) {
      var bot = bots.get(i);
      var source = graph.nearestNodeWithin(bot.pos(), 2);
      var costs = source.isPresent() ? graph.costsFrom(source.getAsInt()) : new float[0];
      for (var j = 0; j < slots.size(); j++) {
        var slot = slots.get(j);
        var distance = referenceDistance(graph, bot, slot, costs);
        var member = dealing.situation().memberOf(bot.id());
        var held = slot.key().equals(dealing.previous().assignment().get(bot.id()));
        profit[i][j] =
            SlotFit.of(member, slot, false)
                - 0.6 * Math.min(distance, 128 * (float) (1 / 0.215)) / (64 * (float) (1 / 0.215))
                + (held ? 0.3 : 0)
                + (member.archetype() == Archetype.TROLL ? 0.12 * random.nextDouble() : 0);
      }
    }
    var columns = Hungarian.maximize(profit);
    var result = new HashMap<CombatantId, String>();
    for (var i = 0; i < bots.size(); i++) result.put(bots.get(i).id(), slots.get(columns[i]).key());
    return result;
  }

  private static double referenceDistance(
      NavGraph graph, CombatantView bot, Slot slot, float[] costs) {
    var target = graph.nearestNodeWithin(slot.pos(), 3);
    return costs.length > 0 && target.isPresent() && Float.isFinite(costs[target.getAsInt()])
        ? costs[target.getAsInt()]
        : bot.pos().horizontalDistance(slot.pos()) * 2;
  }
}
