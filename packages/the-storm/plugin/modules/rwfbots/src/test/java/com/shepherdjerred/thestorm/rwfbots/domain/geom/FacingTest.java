package com.shepherdjerred.thestorm.rwfbots.domain.geom;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import org.junit.jupiter.api.Test;

final class FacingTest {

  @Test
  void southIsPositiveZAndWestIsNegativeX() {
    assertThat(Facing.SOUTH.direction().z()).isCloseTo(1, within(1e-9));
    assertThat(new Facing(90, 0).direction().x()).isCloseTo(-1, within(1e-9));
    assertThat(new Facing(0, -90).direction().y()).isCloseTo(1, within(1e-9));
  }

  @Test
  void directionRoundTrips() {
    var facing = new Facing(-123.4, 31.2);
    var back = Facing.of(facing.direction());
    assertThat(back.yaw()).isCloseTo(facing.yaw(), within(1e-6));
    assertThat(back.pitch()).isCloseTo(facing.pitch(), within(1e-6));
  }

  @Test
  void wrapsYawTheShortWayRound() {
    assertThat(new Facing(350, 0).yaw()).isCloseTo(-10, within(1e-9));
    assertThat(new Facing(-170, 0).yawDelta(new Facing(170, 0))).isCloseTo(-20, within(1e-9));
  }

  @Test
  void turnTowardNeverExceedsTheCap() {
    var from = new Facing(0, 0);
    var target = new Facing(90, 40);
    var turned = from.turnToward(target, 10);
    assertThat(turned.yaw()).isCloseTo(10, within(1e-9));
    assertThat(turned.pitch()).isCloseTo(10, within(1e-9));
    assertThat(from.turnToward(target, 1000)).isEqualTo(target);
  }

  @Test
  void rejectsBadPitch() {
    assertThatThrownBy(() -> new Facing(0, 91)).isInstanceOf(IllegalArgumentException.class);
  }
}
