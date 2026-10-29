package com.shepherdjerred.thestorm.rwfbots.domain.team;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwfbots.domain.Fixtures;
import com.shepherdjerred.thestorm.rwfbots.domain.map.DistanceField;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombOwner;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.Test;

final class ObjectiveChoiceTest {
  private static final NavArtifact NAV = SyntheticMap.bake();

  private static List<BombView> bombs() {
    var sites = NAV.sites().bombs();
    return java.util.stream.IntStream.range(0, sites.size())
        .mapToObj(
            index ->
                new BombView(
                    new BombId(index),
                    new BombOwner.Team(Fixtures.BLUE),
                    sites.get(index).cell().center(),
                    new BombState.Idle()))
        .toList();
  }

  private static TeamBrain.TeamSituation situation(NavArtifact nav, boolean nearLast) {
    var goal = NAV.sites().bombs().getLast();
    var bot =
        Fixtures.combatant(
            1,
            Fixtures.RED,
            nearLast
                ? NAV.graph().feet(NAV.approachNode(goal).orElseThrow())
                : NAV.sites().spawns().getFirst().cell().feet());
    var world =
        new WorldSnapshot(
            40,
            MatchPhase.LIVE,
            List.of(bot),
            bombs(),
            PoisonView.NONE,
            nav.mapId(),
            List.of(),
            List.of(),
            List.of());
    return new TeamBrain.TeamSituation(
        nav,
        world,
        List.of(bot),
        Map.of(
            bot.id(),
            new SlotFit.Member(
                Archetype.TACTICIAN, Set.of(), Map.of(Role.PLANT, 1.0), Kit.TROOPER)));
  }

  private static NavArtifact costs(float first, float last) {
    var fields = new java.util.HashMap<String, DistanceField>();
    for (var site : NAV.sites().bombs()) {
      var values = new float[NAV.graph().nodeCount()];
      Arrays.fill(values, site.equals(NAV.sites().bombs().getFirst()) ? first : last);
      var original = java.util.Objects.requireNonNull(NAV.distanceFields().get(site.name()));
      for (var node = 0; node < values.length; node++) {
        if (original.at(node) == 0) values[node] = 0;
      }
      fields.put(site.name(), new DistanceField(values));
    }
    return withFields(fields);
  }

  private static NavArtifact withFields(Map<String, DistanceField> fields) {
    return new NavArtifact(
        NAV.formatVersion(),
        NAV.generatorVersion(),
        NAV.mapId(),
        NAV.blocksSha256(),
        NAV.sites(),
        NAV.grid(),
        NAV.graph(),
        NAV.regions(),
        NAV.cover(),
        NAV.chokepoints(),
        NAV.routes(),
        fields,
        BombScreens.bake(NAV.graph(), NAV.grid(), NAV.sites(), fields));
  }

  private static Blackboard committed() {
    var plan =
        new TeamPlan(
            Optional.of(Strategy.RUSH),
            Optional.empty(),
            Optional.of(new BombId(0)),
            List.of(),
            0.5,
            List.of(),
            Map.of(),
            0,
            java.util.Map.of(),
            -1);
    return Blackboard.open(Fixtures.RED, Strategy.RUSH).withPlan(plan, 0);
  }

  @Test
  void directedTravelCostsChooseTheReachableObjectiveInsteadOfListOrder() {
    var situation = situation(NAV, true);
    assertThat(
            ObjectiveChoice.choose(
                    Blackboard.open(Fixtures.RED, Strategy.RUSH), situation, situation.bots())
                .orElseThrow()
                .id())
        .isEqualTo(bombs().getLast().id());
    var unreachable = situation(costs(Float.POSITIVE_INFINITY, 10), false);
    assertThat(
            ObjectiveChoice.choose(committed(), unreachable, unreachable.bots()).orElseThrow().id())
        .isEqualTo(bombs().getLast().id());
  }

  @Test
  void smallTravelChangesKeepTheObjectiveButAMajorAdvantageSwitchesIt() {
    var close = situation(costs(11, 10), false);
    assertThat(ObjectiveChoice.choose(committed(), close, close.bots()).orElseThrow().id())
        .isEqualTo(new BombId(0));
    var far = situation(costs(20, 10), false);
    assertThat(ObjectiveChoice.choose(committed(), far, far.bots()).orElseThrow().id())
        .isEqualTo(bombs().getLast().id());
  }

  @Test
  void missingBakedObjectiveFactsFailLoudly() {
    assertThatThrownBy(() -> withFields(Map.of()))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("distance field");
  }
}
