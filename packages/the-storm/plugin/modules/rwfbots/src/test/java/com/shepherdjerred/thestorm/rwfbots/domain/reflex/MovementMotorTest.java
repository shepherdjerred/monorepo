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

  @Test
  void sprintLaunchFollowsTravelAndAirInputPreservesItsMomentum() {
    var launch = MovementMotor.jump(new Vec3(0.28, 0, 0), true);
    assertThat(launch.x()).isCloseTo(0.48, within(1e-9));
    assertThat(launch.y()).isEqualTo(0.42);
    var next =
        MovementMotor.steer(launch, new MovementMotor.Control(new Vec3(1, 0, 0), true, false, 1));
    assertThat(next.x()).isEqualTo(launch.x());
    assertThat(next.y()).isEqualTo(launch.y());
    var reverse =
        MovementMotor.steer(launch, new MovementMotor.Control(new Vec3(-1, 0, 0), true, false, 1));
    assertThat(reverse.x()).isLessThan(launch.x());
  }

  @Test
  void aSprintJumpRightAfterAHitBoostsAlongTheHeadingNotTheKnockback() {
    // Knocked back west while steering east: the boost opposes the blow instead of adding to it.
    var knocked = new Vec3(-0.4, 0, 0);
    var launch = MovementMotor.jump(knocked, true, new Vec3(1, 0, 0));
    assertThat(launch.x()).isCloseTo(-0.2, within(1e-9));
    assertThat(launch.y()).isEqualTo(MovementMotor.JUMP_SPEED);
    // Knocked sideways: the blow is kept but never lengthened by the sprint impulse.
    var sideways = MovementMotor.jump(new Vec3(0, 0, 0.4), true, new Vec3(1, 0, 0));
    assertThat(sideways.z()).isCloseTo(0.4, within(1e-9));
    assertThat(sideways.x()).isCloseTo(0.2, within(1e-9));
    // No steering input: no sprint impulse at all.
    assertThat(MovementMotor.jump(knocked, true, Vec3.ZERO).x()).isCloseTo(-0.4, within(1e-9));
  }

  @Test
  void submergedSteeringCanHoldRiseAndDiveFromTheSameState() {
    assertThat(MovementMotor.swimVertical(0)).isZero();
    assertThat(MovementMotor.swimVertical(2)).isEqualTo(0.16);
    assertThat(MovementMotor.swimVertical(-2)).isEqualTo(-0.16);
    assertThat(MovementMotor.swimVertical(0.1)).isCloseTo(0.05, within(1e-9));
  }

  @Test
  void aClimbExitClearsTheLedgeInsteadOfApproachingItsHeightForever() {
    assertThat(MovementMotor.climbVertical(0.0004)).isEqualTo(0.08);
    assertThat(MovementMotor.climbVertical(0)).isZero();
    assertThat(MovementMotor.climbVertical(-2)).isEqualTo(-0.15);
  }
}
