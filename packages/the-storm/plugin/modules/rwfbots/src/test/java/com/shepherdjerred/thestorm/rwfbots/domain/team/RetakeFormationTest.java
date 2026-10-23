package com.shepherdjerred.thestorm.rwfbots.domain.team;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.Fixtures;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombOwner;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.SplittableRandom;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

final class RetakeFormationTest {
  private static final NavArtifact NAV = SyntheticMap.bake();

  private static BombView bomb(boolean armed) {
    var site = NAV.sites().bombs().getFirst();
    return new BombView(
        new BombId(0),
        new BombOwner.Team(Fixtures.RED),
        site.cell().center(),
        armed ? new BombState.Armed(200) : new BombState.Idle());
  }

  private static List<CombatantView> bots(int count) {
    return IntStream.range(0, count)
        .mapToObj(
            index ->
                Fixtures.combatant(
                    index + 1, Fixtures.RED, NAV.graph().feet(index % NAV.graph().nodeCount())))
        .toList();
  }

  private static TeamBrain.TeamSituation situation(
      long tick, boolean armed, List<CombatantView> bots) {
    var world =
        new WorldSnapshot(
            tick,
            MatchPhase.LIVE,
            bots,
            List.of(bomb(armed)),
            PoisonView.NONE,
            NAV.mapId(),
            List.of(),
            List.of(),
            List.of());
    var members =
        bots.stream()
            .collect(
                Collectors.toUnmodifiableMap(
                    CombatantView::id,
                    bot ->
                        new SlotFit.Member(
                            Archetype.TACTICIAN,
                            Set.of(),
                            Map.of(Role.RETAKE, 1.0, Role.DEFEND, 1.0),
                            Kit.TROOPER)));
    return new TeamBrain.TeamSituation(NAV, world, bots, members);
  }

  @Test
  void lightingAndDefusingTheOwnFuseRedealsImmediatelyWithTwoWorkersAndAScreen() {
    var bots = bots(8);
    var board =
        TeamBrain.tick(
            Blackboard.open(Fixtures.RED, Strategy.RUSH),
            situation(0, false, bots),
            new SplittableRandom(7));
    var lit = TeamBrain.tick(board, situation(1, true, bots), new SplittableRandom(8));
    assertThat(lit.rolesAssignedTick()).isEqualTo(1);
    assertThat(lit.holders(Role.RETAKE)).hasSize(2);
    assertThat(lit.holders(Role.DEFEND)).hasSize(6);
    assertThat(lit.plan().slots()).extracting(Slot::pos).doesNotHaveDuplicates();
    var saved = TeamBrain.tick(lit, situation(2, false, bots), new SplittableRandom(9));
    assertThat(saved.rolesAssignedTick()).isEqualTo(2);
    assertThat(saved.holders(Role.RETAKE)).isEmpty();
  }

  @Test
  void tinyOrVerticalDefenseSpaceKeeps256ValidReserveJobsWithoutAFailedComputeCycle() {
    var layouts = new java.util.HashMap<String, BombScreens.Layout>();
    NAV.bombScreens()
        .sites()
        .forEach(
            (name, layout) ->
                layouts.put(
                    name, new BombScreens.Layout(layout.workers().subList(0, 1), List.of(), 0)));
    var tight =
        new NavArtifact(
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
            NAV.distanceFields(),
            new BombScreens(layouts));
    var bots = bots(256);
    var slots = RetakeFormation.slots(tight, bomb(true), bots, TeamPlan.NONE);
    assertThat(slots).hasSize(256);
    assertThat(slots.stream().filter(slot -> slot.role() == Role.RETAKE)).hasSize(1);
    assertThat(slots.stream().filter(slot -> slot.role() == Role.ROTATE)).hasSize(255);
    assertThat(slots)
        .allSatisfy(slot -> assertThat(tight.graph().nearestNodeWithin(slot.pos(), 0)).isPresent());
    var held = slots.get(1);
    var previous =
        new TeamPlan(
            Optional.of(Strategy.RUSH),
            Optional.empty(),
            Optional.empty(),
            List.of(),
            0,
            List.of(held),
            Map.of(bots.get(1).id(), held.key()),
            0,
            java.util.Map.of());
    var airborne = List.of(bots.get(0), bots.get(1).withPos(bots.get(1).pos().plus(0, 20, 0)));
    assertThat(RetakeFormation.slots(tight, bomb(true), airborne, previous).get(1).pos())
        .isEqualTo(held.pos());
  }
}
