package com.shepherdjerred.thestorm.rwfbots.domain.team;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.Fixtures;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class SquadCohesionTest {
  private static final Vec3 GOAL = new Vec3(20.5, 1, 5.5);
  private static final TeamBrain.Odds EVEN = new TeamBrain.Odds(3, 3, false);

  private static TeamPlan previous() {
    var slots = List.of(slot("left"), slot("middle"), slot("right"));
    return new TeamPlan(
        Optional.of(Strategy.SPLIT),
        Optional.empty(),
        Optional.empty(),
        List.of(),
        0.5,
        slots,
        Map.of(
            new CombatantId(1), "left", new CombatantId(2), "middle", new CombatantId(3), "right"),
        0,
        Map.of(),
        -1);
  }

  private static Slot slot(String key) {
    return new Slot(key, SlotKind.LANE, Role.ROTATE, GOAL, GOAL, -1, -1, Optional.empty(), 0);
  }

  private static CombatantView bot(int id, boolean arrived) {
    return Fixtures.combatant(id, Fixtures.RED, arrived ? GOAL : new Vec3(1.5, 1, 5.5));
  }

  @Test
  void theLineWaitsForTheSquadRatherThanAdvancingOnElapsedTimeAlone() {
    var plan = previous();
    assertThat(
            TeamBrain.push(
                plan,
                List.of(bot(1, false), bot(2, false), bot(3, true)),
                contact(EVEN, false),
                40))
        .isEqualTo(plan.push());
    assertThat(
            TeamBrain.push(
                plan, List.of(bot(1, true), bot(2, true), bot(3, false)), contact(EVEN, false), 40))
        .isEqualTo(plan.push() + Playbook.ADVANCE);
  }

  @Test
  void contactAndDifferentFloorsDoNotCountAsAReadyAssaultLine() {
    var plan = previous();
    assertThat(
            TeamBrain.push(
                plan, List.of(bot(1, true), bot(2, true), bot(3, true)), contact(EVEN, true), 40))
        .isEqualTo(plan.push());
    var above =
        List.of(bot(1, true), bot(2, true), bot(3, true)).stream()
            .map(bot -> bot.withPos(bot.pos().plus(0, 4, 0)))
            .toList();
    assertThat(TeamBrain.push(plan, above, contact(EVEN, false), 40)).isEqualTo(plan.push());
    assertThat(TeamBrain.ERRATIC).isLessThan(TeamBrain.STICKY);
  }

  private static Slot lane(int index) {
    return new Slot(
        "lane-" + index,
        SlotKind.LANE,
        Role.ROTATE,
        Vec3.ZERO,
        Vec3.ZERO,
        index,
        -1,
        Optional.empty(),
        0);
  }

  @Test
  void squadMembersPreferTheSameRouteWhileSolosKeepTheirIndividualAssignment() {
    var one = new CombatantId(1);
    var two = new CombatantId(2);
    var solo = new CombatantId(3);
    var groups = Map.of(one, 1, two, 1, solo, -1);
    assertThat(SquadCohesion.fit(groups, one, lane(1), 2))
        .isPositive()
        .isEqualTo(SquadCohesion.fit(groups, two, lane(1), 2));
    assertThat(SquadCohesion.fit(groups, one, lane(0), 2)).isZero();
    assertThat(SquadCohesion.fit(groups, solo, lane(0), 2)).isZero();
    assertThat(SquadCohesion.fit(groups, solo, lane(1), 2)).isZero();
  }

  @Test
  void sharedRoutesCannotOutweighAWholeYardOfAdditionalTravel() {
    var bot = new CombatantId(1);
    var bonus = SquadCohesion.fit(Map.of(bot, 1), bot, lane(1), 2);
    var detourCost =
        TeamBrain.DISTANCE_WEIGHT
            * com.shepherdjerred.thestorm.rwfbots.domain.map.TraversalCosts.walkingTicks(8)
            / TeamBrain.DISTANCE_SCALE;
    assertThat(bonus).isPositive().isLessThan(detourCost);
  }

  @Test
  void cohesionLeavesUnlanedRolesAndSingleRouteMapsAlone() {
    var bot = new CombatantId(1);
    assertThat(SquadCohesion.fit(Map.of(bot, 1), bot, lane(-1), 2)).isZero();
    assertThat(SquadCohesion.fit(Map.of(bot, 1), bot, lane(0), 1)).isZero();
  }

  private static TeamBrain.Odds contact(TeamBrain.Odds odds, boolean contact) {
    return new TeamBrain.Odds(odds.ours(), odds.theirs(), contact);
  }
}
