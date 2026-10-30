package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombOwner;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class FrozenWatchTest {

  private static final Vec3 SPOT = new Vec3(10.5, 64, 10.5);
  private static final BombView BOMB =
      new BombView(
          new BombId(0), new BombOwner.Team(BLUE), new Vec3(13, 64.5, 10.5), new BombState.Idle());

  private static WorldSnapshot snapshot(long tick, CombatantView self) {
    return new WorldSnapshot(
        tick,
        MatchPhase.LIVE,
        List.of(self),
        List.of(BOMB),
        PoisonView.NONE,
        "test",
        List.of(),
        List.of(),
        List.of());
  }

  private static Decision routing(CombatantView self, long tick) {
    return Decision.idle(self.id(), tick, 0)
        .withWaypoints(List.of(new Waypoint(SPOT.plus(1, 0, 0), Hop.WALK)));
  }

  /** The ticks at which watching {@code self} follow {@code decision} for 400 ticks reports it. */
  private static List<Long> reports(CombatantView self, Decision decision) {
    var state = FrozenWatch.State.START;
    var reported = new ArrayList<Long>();
    for (var tick = 0L; tick < 400; tick++) {
      var step = FrozenWatch.observe(state, self, decision, snapshot(tick, self));
      state = step.state();
      if (step.frozen().isPresent()) reported.add(tick);
    }
    return reported;
  }

  @Test
  void aBotStandingStillWithSomewhereToGoIsFrozenAfterEightSecondsAndReportedEveryEight() {
    var self = combatant(1, RED, SPOT);
    assertThat(reports(self, routing(self, 0))).containsExactly(160L, 320L);
  }

  @Test
  void aBotHoldingWithNowhereToGoIsNotFrozen() {
    var self = combatant(1, RED, SPOT);
    assertThat(reports(self, Decision.idle(self.id(), 0, 0))).isEmpty();
  }

  @Test
  void aBotWorkingAFuseWithinReachIsNotFrozenThoughItsDecisionStillRoutes() {
    // The decision of a bot clicking a fuse still carries the route to the bomb's approach.
    var self = combatant(1, RED, SPOT);
    var arming =
        new Decision(
            self.id(),
            Option.ARM,
            Optional.empty(),
            List.of(new Waypoint(SPOT.plus(1, 0, 0), Hop.WALK)),
            com.shepherdjerred.thestorm.rwfbots.domain.world.Stance.CAUTIOUS,
            Optional.of(BOMB.id()),
            Optional.empty(),
            Optional.empty(),
            "arm:route",
            0,
            0,
            Optional.empty());
    assertThat(reports(self, arming)).isEmpty();
    var outOfReach = self.withPos(SPOT.plus(-3, 0, 0));
    assertThat(reports(outOfReach, arming)).containsExactly(160L, 320L);
  }

  @Test
  void aBotThatTurnsOrMovesIsNotFrozen() {
    var self = combatant(1, RED, SPOT);
    var decision = routing(self, 0);
    var state = FrozenWatch.State.START;
    for (var tick = 0L; tick < 400; tick++) {
      var looking =
          self.withFacing(
              new com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing(
                  tick % 20 < 10 ? 0 : 30, 0));
      var step = FrozenWatch.observe(state, looking, decision, snapshot(tick, looking));
      state = step.state();
      assertThat(step.frozen()).isEmpty();
    }
  }
}
