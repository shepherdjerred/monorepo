package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.JumpLaunch;
import java.util.function.Predicate;
import org.junit.jupiter.api.Test;

final class RunUpSafetyTest {
  private static final JumpLaunch LAUNCH =
      new JumpLaunch(new Vec3(3.7, 1, 2.5), new Vec3(1.7, 1, 2.5), 0.27, 13);

  private record Terrain(Predicate<Vec3> floor, Predicate<Vec3> danger)
      implements MovementSafety.Terrain {
    @Override
    public boolean clear(Vec3 feet) {
      return true;
    }

    @Override
    public boolean supported(Vec3 feet, double drop) {
      return floor.test(feet);
    }

    @Override
    public boolean grounded(Vec3 feet) {
      return floor.test(feet);
    }

    @Override
    public boolean hazardous(Vec3 feet) {
      return danger.test(feet);
    }

    @Override
    public boolean inside(Vec3 feet) {
      return feet.x() >= 0 && feet.x() < 8 && feet.y() == 1 && feet.z() >= 0 && feet.z() < 8;
    }

    @Override
    public boolean climbable(Vec3 feet) {
      return false;
    }

    @Override
    public boolean footing(Vec3 feet, double drop) {
      return supported(feet, drop);
    }
  }

  @Test
  void groundedForwardInputCanReachTheMeasuredLaunchWindowButCannotWalkPastIt() {
    var terrain = new Terrain(point -> point.x() < 4, point -> false);
    var from = LAUNCH.takeoff().plus(-0.23, 0, 0);
    assertThat(RunUpSafety.permits(terrain, LAUNCH, from, from.plus(0.28, 0, 0))).isTrue();
    assertThat(RunUpSafety.permits(terrain, LAUNCH, from, from.plus(0.5, 0, 0))).isFalse();
    assertThat(RunUpSafety.permits(terrain, LAUNCH, from, from.plus(0.28, 0, 0.1))).isFalse();
  }

  @Test
  void aSafeLandingDoesNotAllowTheGroundedApproachToCrossMissingOrBurningRunway() {
    var from = LAUNCH.takeoff().plus(-0.23, 0, 0);
    var next = from.plus(0.28, 0, 0);
    var missing = new Terrain(point -> point.x() < 3.6 || point.x() >= 7, point -> false);
    var burning = new Terrain(point -> true, point -> point.x() >= 3.6);
    assertThat(RunUpSafety.permits(missing, LAUNCH, from, next)).isFalse();
    assertThat(RunUpSafety.permits(burning, LAUNCH, from, next)).isFalse();
  }
}
