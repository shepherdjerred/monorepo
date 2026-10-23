package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/**
 * A door in a wall along x = 10: the bot has fled east through it and stands just past it, an enemy
 * follows from the west.
 */
final class DoorShutTest {
  private static final BlockPos DOOR = new BlockPos(10, 1, 5);
  private static final Vec3 PAST = new Vec3(11.6, 1, 5.5);
  private static final Vec3 AWAY = new Vec3(18.5, 1, 5.5);
  private static final CombatantView CHASER = combatant(2, BLUE, new Vec3(5.5, 1, 5.5));

  private static Decision fleeing(Option option, Stance stance, Vec3... route) {
    return new Decision(
        new CombatantId(1),
        option,
        Optional.empty(),
        java.util.Arrays.stream(route).map(point -> new Waypoint(point, Hop.WALK)).toList(),
        stance,
        Optional.empty(),
        Optional.empty(),
        Optional.empty(),
        "retreat:flee",
        100,
        0,
        Optional.empty());
  }

  private static Optional<BlockPos> shut(
      Vec3 self, Decision decision, List<CombatantView> pursuers, List<CombatantView> allies) {
    return DoorShut.behind(
        new DoorShut.Escape(combatant(1, RED, self), decision, 0, pursuers, allies), List.of(DOOR));
  }

  private static Decision retreat() {
    return fleeing(Option.RETREAT, Stance.EVASIVE, AWAY);
  }

  @Test
  void aFleeingBotShutsTheDoorBehindItWhenAnEnemyFollows() {
    assertThat(shut(PAST, retreat(), List.of(CHASER), List.of())).contains(DOOR);
    // An archer backing off a fight is breaking contact too.
    assertThat(shut(PAST, fleeing(Option.ENGAGE, Stance.EVASIVE, AWAY), List.of(CHASER), List.of()))
        .contains(DOOR);
  }

  @Test
  void aTeammateStillComingThroughKeepsTheDoorOpen() {
    var following = combatant(3, RED, new Vec3(7.5, 1, 5.5));
    assertThat(shut(PAST, retreat(), List.of(CHASER), List.of(following))).isEmpty();
    var inTheDoorway = combatant(3, RED, new Vec3(10.4, 1, 5.5));
    assertThat(shut(PAST, retreat(), List.of(CHASER), List.of(inTheDoorway))).isEmpty();
    var alreadyThrough = combatant(3, RED, new Vec3(13.5, 1, 6.5));
    assertThat(shut(PAST, retreat(), List.of(CHASER), List.of(alreadyThrough))).contains(DOOR);
  }

  @Test
  void theBotNeverShutsADoorItsOwnRouteGoesThrough() {
    var back = fleeing(Option.RETREAT, Stance.EVASIVE, new Vec3(10.5, 1, 5.5), AWAY);
    assertThat(shut(PAST, back, List.of(CHASER), List.of())).isEmpty();
    var turning = fleeing(Option.RETREAT, Stance.EVASIVE, new Vec3(7.5, 1, 8.5));
    assertThat(shut(PAST, turning, List.of(CHASER), List.of())).isEmpty();
  }

  @Test
  void theBotDoesNotShutTheDoorItStillStandsIn() {
    assertThat(shut(new Vec3(10.6, 1, 5.5), retreat(), List.of(CHASER), List.of())).isEmpty();
  }

  @Test
  void onlyAnEscapeFromAFollowingEnemyShutsTheDoor() {
    assertThat(shut(PAST, retreat(), List.of(), List.of())).isEmpty();
    var ahead = combatant(2, BLUE, new Vec3(15.5, 1, 5.5));
    assertThat(shut(PAST, retreat(), List.of(ahead), List.of())).isEmpty();
    var farBehind = combatant(2, BLUE, new Vec3(10.5 - DoorShut.PURSUIT - 2, 1, 5.5));
    assertThat(shut(PAST, retreat(), List.of(farBehind), List.of())).isEmpty();
    var holding = fleeing(Option.HOLD_SLOT, Stance.CAUTIOUS, AWAY);
    assertThat(shut(PAST, holding, List.of(CHASER), List.of())).isEmpty();
  }

  @Test
  void aDoorOutOfReachIsLeftAlone() {
    assertThat(shut(new Vec3(14.5, 1, 5.5), retreat(), List.of(CHASER), List.of())).isEmpty();
  }
}
