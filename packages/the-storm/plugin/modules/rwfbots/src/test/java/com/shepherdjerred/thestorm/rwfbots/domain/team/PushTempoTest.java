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

/** How the push moves when a team is in contact, winning, or closing out the round. */
final class PushTempoTest {
  private static final Vec3 GOAL = new Vec3(20.5, 1, 5.5);
  private static final List<CombatantView> SCATTERED =
      List.of(
          Fixtures.combatant(1, Fixtures.RED, new Vec3(1.5, 1, 5.5)),
          Fixtures.combatant(2, Fixtures.RED, new Vec3(1.5, 1, 8.5)));

  private static TeamPlan dealtAt(long pushedTick) {
    var slot =
        new Slot("lane-0", SlotKind.LANE, Role.ROTATE, GOAL, GOAL, -1, -1, Optional.empty(), 0);
    return new TeamPlan(
        Optional.of(Strategy.RUSH),
        Optional.empty(),
        Optional.empty(),
        List.of(),
        Playbook.START_PUSH,
        List.of(slot),
        Map.of(new CombatantId(1), "lane-0"),
        pushedTick,
        Map.of(),
        pushedTick);
  }

  @Test
  void anEvenStalemateStillMovesAfterTheStall() {
    var plan = dealtAt(100);
    var even = new TeamBrain.Odds(12, 12, false);
    assertThat(
            TeamBrain.push(plan, SCATTERED, contact(even, true), 100 + TeamBrain.STALL_TICKS - 1))
        .as("an even fight holds the line")
        .isEqualTo(plan.push());
    assertThat(TeamBrain.push(plan, SCATTERED, contact(even, true), 100 + TeamBrain.STALL_TICKS))
        .as("but not for ever")
        .isEqualTo(plan.push() + Playbook.ADVANCE);
    assertThat(TeamBrain.push(plan, SCATTERED, contact(even, false), 100 + TeamBrain.STALL_TICKS))
        .as("nor does a line that never forms up")
        .isEqualTo(plan.push() + Playbook.ADVANCE);
  }

  @Test
  void aTeamWinningTheFightPressesItWithoutWaiting() {
    var plan = dealtAt(100);
    assertThat(
            TeamBrain.push(plan, SCATTERED, contact(new TeamBrain.Odds(10, 8, false), true), 140))
        .isEqualTo(plan.push() + Playbook.ADVANCE);
    assertThat(
            TeamBrain.push(plan, SCATTERED, contact(new TeamBrain.Odds(10, 9, false), true), 140))
        .as("one up is still an even fight")
        .isEqualTo(plan.push());
    assertThat(TeamBrain.push(plan, SCATTERED, contact(new TeamBrain.Odds(5, 4, false), true), 140))
        .as("nor is five against four a lead worth a rush")
        .isEqualTo(plan.push());
  }

  @Test
  void aTeamClosingOutTheRoundSendsEveryoneForward() {
    var plan = dealtAt(100);
    assertThat(
            TeamBrain.push(plan, SCATTERED, contact(new TeamBrain.Odds(16, 2, false), true), 140))
        .isEqualTo(Playbook.MAX_PUSH)
        .isGreaterThanOrEqualTo(Playbook.PLANT_GO);
    assertThat(new TeamBrain.Odds(16, 2, false).closing()).isTrue();
    assertThat(new TeamBrain.Odds(10, 5, false).closing()).isTrue();
    assertThat(new TeamBrain.Odds(3, 2, false).closing()).as("the enemy's last two").isTrue();
    assertThat(new TeamBrain.Odds(2, 2, false).closing()).as("an even two a side").isFalse();
    assertThat(new TeamBrain.Odds(9, 5, false).closing()).isFalse();
    assertThat(new TeamBrain.Odds(36, 36, false).closing()).isFalse();
    assertThat(new TeamBrain.Odds(4, 0, false).closing()).as("nobody left to close on").isFalse();
  }

  @Test
  void largeTeamsCarrySeveralFuses() {
    assertThat(Playbook.planters(8)).isEqualTo(1);
    assertThat(Playbook.planters(16)).isEqualTo(2);
    assertThat(Playbook.planters(24)).isEqualTo(3);
    assertThat(Playbook.planters(36)).isEqualTo(4);
    for (var strategy : Strategy.values()) {
      for (var size = 3; size <= 40; size++) {
        assertThat(
                Playbook.wants(strategy, size, true).stream()
                    .filter(want -> want.kind() == SlotKind.PLANT)
                    .count())
            .as("%s team of %d", strategy, size)
            .isEqualTo(Playbook.planters(size));
      }
    }
  }

  @Test
  void theCloserRushesThePlantAndHuntsWithTheRest() {
    var wants = Playbook.wants(Strategy.TURTLE, 16, true, true);
    assertThat(wants.stream().filter(want -> want.kind() == SlotKind.PLANT).count()).isEqualTo(2);
    assertThat(wants.stream().filter(want -> want.kind() == SlotKind.ESCORT).count()).isEqualTo(2);
    assertThat(wants.stream().filter(want -> want.kind() == SlotKind.ANCHOR).count()).isEqualTo(1);
    assertThat(wants.stream().filter(want -> want.kind() == SlotKind.SWEEP).count())
        .isGreaterThanOrEqualTo(10);
  }

  private static TeamBrain.Odds contact(TeamBrain.Odds odds, boolean contact) {
    return new TeamBrain.Odds(odds.ours(), odds.theirs(), contact);
  }
}
