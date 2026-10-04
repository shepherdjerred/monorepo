package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Lever;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

final class AimControllerTest {

  @Test
  void convergesOnAStationaryTargetWithinTheNoiseBand() {
    var levers = levers(0.9).with(Lever.AIM_ERROR_DEG, 0.5);
    var random = new SplittableRandom(3);
    var target = new Facing(120, -15);
    var state = AimState.looking(new Facing(-60, 30));
    for (var tick = 0; tick < 60; tick++) {
      state = AimController.aim(state, target, levers, random);
    }
    var errors = 0.0;
    for (var tick = 0; tick < 200; tick++) {
      state = AimController.aim(state, target, levers, random);
      errors = Math.max(errors, state.look().differenceTo(target));
    }
    assertThat(errors).isLessThan(2.5);
  }

  @Test
  void neverTurnsFasterThanTheCap() {
    for (var skill : new double[] {0, 0.5, 1}) {
      var levers = levers(skill);
      var random = new SplittableRandom(11);
      var state = AimState.looking(Facing.SOUTH);
      var target = new Facing(170, 60);
      for (var tick = 0; tick < 100; tick++) {
        var before = state.look();
        state = AimController.aim(state, target, levers, random);
        assertThat(before.differenceTo(state.look()))
            .as("skill %s tick %d", skill, tick)
            .isLessThanOrEqualTo(levers.turnRateDegPerTick() + 1e-9);
        if (tick % 17 == 0) {
          target = new Facing(-target.yaw(), -target.pitch());
        }
      }
    }
  }

  @Test
  void reactionDelayHoldsTheOldTargetForReactionTicks() {
    var levers = levers(0).with(Lever.AIM_ERROR_DEG, 0.5);
    var random = new SplittableRandom(5);
    var state = AimState.looking(Facing.SOUTH);
    for (var tick = 0; tick < 40; tick++) {
      state = AimController.aim(state, Facing.SOUTH, levers, random);
    }
    var jumped = new Facing(90, 0);
    var moved = 0;
    for (var tick = 0; tick < levers.reactionTicks() - 1; tick++) {
      state = AimController.aim(state, jumped, levers, random);
      if (Math.abs(state.look().yaw()) > 5) {
        moved++;
      }
    }
    assertThat(moved).isZero();
    for (var tick = 0; tick < 30; tick++) {
      state = AimController.aim(state, jumped, levers, random);
    }
    assertThat(state.look().differenceTo(jumped)).isLessThan(3);
  }
}
