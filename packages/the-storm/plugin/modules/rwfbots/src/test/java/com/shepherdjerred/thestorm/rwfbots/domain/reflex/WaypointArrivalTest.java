package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.JumpLaunch;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TraversalState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class WaypointArrivalTest {
  @Test
  void approximateGroundFlagCannotFinishAnUnpaidGroundLanding() {
    var landing = new Vec3(2.5, 1, 2.5);
    var unpaid =
        combatant(1, RED, landing.plus(0, 0.03, 0))
            .withMotion(false, true)
            .withTraversal(TraversalState.UNMODIFIED.withFallDistance(8));
    var drop = new Waypoint(landing, Hop.DROP);
    var leap =
        new Waypoint(
            landing,
            Hop.LEAP,
            Optional.of(new JumpLaunch(new Vec3(0.5, 9, 2.5), new Vec3(-1.5, 9, 2.5), 0.27, 20)));
    for (var waypoint : List.of(drop, leap)) {
      assertThat(WaypointArrival.reached(unpaid, waypoint)).isFalse();
      assertThat(WaypointArrival.reached(unpaid.withTraversal(TraversalState.UNMODIFIED), waypoint))
          .isTrue();
    }
  }

  @Test
  void explicitFluidAndClimbContactsStillCancelPendingFallWithoutGround() {
    var landing = new Vec3(2.5, 1, 2.5);
    var entering =
        combatant(1, RED, landing)
            .withMotion(false, false)
            .withTraversal(TraversalState.UNMODIFIED.withFallDistance(8));
    for (var kind : List.of(Waypoint.Landing.WATER, Waypoint.Landing.CLIMB))
      assertThat(
              WaypointArrival.reached(
                  entering, new Waypoint(landing, Hop.DROP, Optional.empty(), kind)))
          .isTrue();
  }
}
