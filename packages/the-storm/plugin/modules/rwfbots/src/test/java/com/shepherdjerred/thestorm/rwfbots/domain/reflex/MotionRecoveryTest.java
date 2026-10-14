package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import org.junit.jupiter.api.Test;

final class MotionRecoveryTest {
  @Test
  void persistsAcrossChangingWaypointsThenEscapesAndReplans() {
    var position = new Vec3(5, 1, 5);
    var state = MotionRecovery.State.INITIAL;
    var jumps = 0;
    var replans = 0;
    for (var tick = 0; tick <= 40; tick++) {
      var step = MotionRecovery.tick(state, position, new Vec3(10 + tick, 1, 5), tick);
      state = step.state();
      if (step.jump()) jumps++;
      if (step.replan()) replans++;
      if (tick == 20) assertThat(step.destination().z()).isGreaterThan(position.z());
      if (tick == 40) assertThat(step.destination().z()).isLessThan(position.z());
    }
    assertThat(jumps).isEqualTo(2);
    assertThat(replans).isEqualTo(1);
  }

  @Test
  void realProgressClearsAttempts() {
    var position = new Vec3(5, 1, 5);
    var destination = new Vec3(10, 1, 5);
    var stalled =
        MotionRecovery.tick(MotionRecovery.State.INITIAL, position, destination, 0).state();
    stalled = MotionRecovery.tick(stalled, position, destination, 20).state();
    var recovered = MotionRecovery.tick(stalled, position.plus(1, 0, 0), destination, 33);
    assertThat(recovered.state().attempts()).isZero();
    assertThat(recovered.jump()).isFalse();
  }

  @Test
  void verticalSwimmingOrClimbingCountsAsProgress() {
    var position = new Vec3(5, 1, 5);
    var target = position.plus(0, 4, 0);
    var first = MotionRecovery.tick(MotionRecovery.State.INITIAL, position, target, 0);
    var rising = MotionRecovery.tick(first.state(), position.plus(0, 1, 0), target, 21);
    assertThat(rising.jump()).isFalse();
    assertThat(rising.state().progressAt()).isEqualTo(21);
    var blocked = MotionRecovery.tick(first.state(), position, target, 21);
    assertThat(blocked.jump()).isTrue();
  }
}
