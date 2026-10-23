package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.RouteResult;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Which walks let a bow shoot out to the middle of its band. */
final class PaceTest {
  @Test
  void aRetakeOrHuntWalkIsTaskedButTheWalksToASlotOrTheBombStayAtTheNearEdge() {
    // Archers retaking with enemies in plain sight shot only inside the near edge of their band,
    // failing the archery report card's shots per minute.
    for (var option : new Option[] {Option.RETAKE, Option.HUNT}) {
      assertThat(Pace.route(Stance.CAUTIOUS, false, option))
          .as("%s", option)
          .isEqualTo(Pace.TASKED);
    }
    // Stopping to shoot on the way to the bomb held a rushing ranged roster back in the opening.
    for (var option : new Option[] {Option.ARM, Option.HELP_ARM}) {
      assertThat(Pace.route(Stance.CAUTIOUS, false, option))
          .as("%s", option)
          .isEqualTo(Pace.MOVING);
    }
    assertThat(Pace.route(Stance.AGGRESSIVE, false, Option.TAKE_SLOT)).isEqualTo(Pace.MOVING);
    assertThat(Pace.route(Stance.CAUTIOUS, true, Option.ARM)).as("a bound").isEqualTo(Pace.DASHING);
    assertThat(Pace.route(Stance.EVASIVE, false, Option.RETAKE)).isEqualTo(Pace.DASHING);
    assertThat(Pace.route(Stance.STEALTH, false, Option.HUNT)).isEqualTo(Pace.HIDING);
  }

  @Test
  void aLastSurvivorSneakingToItsHoldTakesNoShot() {
    // Review finding: an unarrived stealth hold walked at MOVING, letting a hiding bot shoot.
    var spot = new Vec3(4.5, 1, 4.5);
    var hold = new PlanStep.Hold(spot, spot.plus(0, 0, 5), Stance.STEALTH);
    var walking = new RouteResult.Path(List.of(new Waypoint(spot, Hop.WALK)));
    assertThat(Pace.hold(hold, walking)).isEqualTo(Pace.HIDING);
    assertThat(Pace.hold(hold, new RouteResult.Arrived())).isEqualTo(Pace.STILL);
  }
}
