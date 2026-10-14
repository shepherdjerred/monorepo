package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.world.TraversalState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import org.junit.jupiter.api.Test;

final class FinalLandingRiskTest {
  @Test
  void harmlessWalkingAndWaterLandingsRemainPossibleBelowOneHealthPoint() {
    var level = new FinalLandingRisk.Descent(0, 0, Waypoint.Landing.GROUND, 1);
    var water = new FinalLandingRisk.Descent(12, 0, Waypoint.Landing.WATER, 1);
    assertThat(FinalLandingRisk.permits(level, TraversalState.UNMODIFIED, 0.5, 0)).isTrue();
    assertThat(FinalLandingRisk.permits(water, TraversalState.UNMODIFIED, 0.5, 0)).isTrue();
  }

  @Test
  void deepDryDropsUseHealthAndAccumulatedNativeFallDistance() {
    var descent = new FinalLandingRisk.Descent(9, 0, Waypoint.Landing.GROUND, 1);
    assertThat(FinalLandingRisk.permits(descent, TraversalState.UNMODIFIED, 3, 0)).isFalse();
    assertThat(FinalLandingRisk.permits(descent, TraversalState.UNMODIFIED, 20, 0)).isTrue();
    var pending = new FinalLandingRisk.Descent(1, -0.7, Waypoint.Landing.GROUND, 1);
    assertThat(
            FinalLandingRisk.permits(pending, TraversalState.UNMODIFIED.withFallDistance(8), 3, 0))
        .isFalse();
  }

  @Test
  void waterAndImmunityPermitTheSameDeepDropOnlyWhileTheMitigationRemainsActive() {
    var dry = new FinalLandingRisk.Descent(12, 0, Waypoint.Landing.GROUND, 1);
    var water = new FinalLandingRisk.Descent(12, 0, Waypoint.Landing.WATER, 1);
    assertThat(FinalLandingRisk.permits(water, TraversalState.UNMODIFIED, 2, 0)).isTrue();
    assertThat(FinalLandingRisk.permits(dry, immuneUntil(100), 2, 0)).isTrue();
    assertThat(FinalLandingRisk.permits(dry, immuneUntil(3), 2, 0)).isFalse();
    assertThat(FinalLandingRisk.permits(dry, immuneUntil(100), 2, 99)).isFalse();
  }

  @Test
  void theJumpApexAndNativeUpwardImpulseAreIncludedInTheLandingBudget() {
    var downward = new FinalLandingRisk.Descent(3, 0, Waypoint.Landing.GROUND, 1);
    var leap =
        new FinalLandingRisk.Descent(3, MovementMotor.JUMP_SPEED, Waypoint.Landing.GROUND, 1);
    assertThat(FinalLandingRisk.permits(downward, TraversalState.UNMODIFIED, 2, 0)).isTrue();
    assertThat(FinalLandingRisk.permits(leap, TraversalState.UNMODIFIED, 2, 0)).isFalse();
  }

  private static TraversalState immuneUntil(long expiry) {
    return new TraversalState(true, 3, 1, 0, -1, -1, expiry, -1, 0, -1, -1, -1, -1, 20, 0);
  }
}
