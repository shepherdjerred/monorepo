package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class RouteLoopsTest {

  private static Waypoint at(double x, double z) {
    return new Waypoint(new Vec3(x, 1, z), Hop.WALK);
  }

  @Test
  void aLongPathThatFinishesWhereItStartedIsALoop() {
    var points = new ArrayList<Waypoint>();
    for (var step = 0; step <= 10; step++) points.add(at(step, 0));
    for (var step = 9; step >= 0; step--) points.add(at(step, 0));
    assertThat(RouteLoops.loops(points)).isTrue();
  }

  @Test
  void aStraightWalkToABombIsNotALoop() {
    var points = new ArrayList<Waypoint>();
    for (var step = 0; step <= 20; step++) points.add(at(step, 0));
    assertThat(RouteLoops.loops(points)).isFalse();
  }

  @Test
  void twoReversalsDropTheGoalAndOneTurnDoesNot() {
    var north = TacticalMemory.EMPTY.follow(Optional.of(new Vec3(0, 0, 1)));
    assertThat(north.drop()).isFalse();
    var east = north.memory().follow(Optional.of(new Vec3(1, 0, 0)));
    assertThat(east.drop()).as("a corner is not a reversal").isFalse();
    var back = north.memory().follow(Optional.of(new Vec3(0, 0, -1)));
    assertThat(back.drop()).isFalse();
    assertThat(back.memory().reversals()).isEqualTo(1);
    var again = back.memory().follow(Optional.of(new Vec3(0, 0, 1)));
    assertThat(again.drop()).isTrue();
  }

}
