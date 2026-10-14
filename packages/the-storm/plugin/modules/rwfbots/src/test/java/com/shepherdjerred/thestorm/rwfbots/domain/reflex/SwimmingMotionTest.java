package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import org.junit.jupiter.api.Test;

final class SwimmingMotionTest {
  @Test
  void holdingInDeepWaterArrestsSinkingAndKeepsTheHeadAboveWater() {
    var feet = 1.0;
    var velocity = new Vec3(0, -0.08, 0);
    for (var tick = 0; tick < 200; tick++) {
      velocity = SwimmingMotion.buoyancy(velocity, feet, 5, false);
      feet += velocity.y();
      velocity = velocity.withY((velocity.y() - 0.02) * 0.8);
    }
    assertThat(feet).isBetween(4.4, 4.7);
    assertThat(feet + 1.62).isGreaterThan(5);
  }

  @Test
  void aBankExitGetsAnUpwardStrokeAndExternalUpwardImpulsesSurvive() {
    assertThat(SwimmingMotion.buoyancy(new Vec3(0.1, -0.1, 0), 0.6, 1, true).y()).isEqualTo(0.3);
    assertThat(SwimmingMotion.buoyancy(new Vec3(0.1, 0.7, 0), 0.6, 1, true).y()).isEqualTo(0.7);
  }

  @Test
  void swimmingHasWaterAccelerationAndUsingAnItemStillSlowsHorizontalMotion() {
    var control = new MovementMotor.Control(new Vec3(1, 0, 0), false, false, 1);
    var normal = MovementMotor.swim(new Vec3(0, -0.05, 0), control);
    var using =
        MovementMotor.swim(
            Vec3.ZERO, new MovementMotor.Control(new Vec3(1, 0, 0), false, false, 0.2));
    assertThat(normal.x()).isCloseTo(0.04, within(1e-9));
    assertThat(normal.y()).isEqualTo(-0.05);
    assertThat(using.x()).isLessThan(normal.x());
  }

  @Test
  void directedRoutesDescendAndHoldDepthInsteadOfBeingForcedToTheSurface() {
    assertThat(SwimmingMotion.directed(new Vec3(0, 0.12, 0), -2, false).y()).isEqualTo(-0.16);
    assertThat(SwimmingMotion.directed(new Vec3(0, -0.1, 0), 0, false).y()).isZero();
    assertThat(SwimmingMotion.directed(new Vec3(0, 0, 0), 2, false).y()).isEqualTo(0.16);
    assertThat(SwimmingMotion.directed(new Vec3(0, 0.7, 0), -2, false).y()).isEqualTo(0.7);
    assertThat(SwimmingMotion.directed(new Vec3(0, -0.1, 0), 1, true).y()).isEqualTo(0.3);
  }
}
