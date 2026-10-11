package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import org.junit.jupiter.api.Test;

final class MovementMotorTest {
  @Test
  void movementDoesNotNeedToPointWhereThePlayerLooks() {
    var next =
        MovementMotor.steer(Vec3.ZERO, new MovementMotor.Control(new Vec3(1, 0, 0), true, true, 1));
    assertThat(next.x()).isCloseTo(0.13, within(1e-9));
    assertThat(next.z()).isZero();
  }

  @Test
  void stoppingRetainsKnockbackAndVerticalVelocity() {
    var next =
        MovementMotor.steer(
            new Vec3(1, 0.42, 0), new MovementMotor.Control(Vec3.ZERO, false, true, 1));
    assertThat(next.x()).isCloseTo(0.9, within(1e-9));
    assertThat(next.y()).isEqualTo(0.42);
  }

  @Test
  void airControlAndUsingAnItemReduceAcceleration() {
    var air =
        MovementMotor.steer(
            Vec3.ZERO, new MovementMotor.Control(new Vec3(1, 0, 0), false, false, 1));
    var drawing =
        MovementMotor.steer(
            Vec3.ZERO, new MovementMotor.Control(new Vec3(1, 0, 0), false, true, 0.2));
    assertThat(air.x()).isCloseTo(0.02, within(1e-9));
    assertThat(drawing.x()).isCloseTo(0.02, within(1e-9));
  }
}
