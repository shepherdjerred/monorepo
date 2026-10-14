package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

final class RangedPositionTest {
  private static double cost(double travel, double height, int retreats, double range) {
    return RangedPosition.cost(
        new RangedPosition.Candidate(travel, height, retreats, range),
        new ArchetypeBias.Range(16, 32));
  }

  @Test
  void anAccessibleWallTopBeatsNearbyLevelCoverButADeadEndDoesNot() {
    var level = cost(3, 0, 2, 24);
    var wall = cost(4, 3, 2, 24);
    var trapped = cost(3, 5, 0, 24);
    assertThat(wall).isLessThan(level);
    assertThat(trapped).isGreaterThan(level);
  }

  @Test
  void beingAboveTheEnemyDoesNotMakeChargingIntoMeleeAUsefulFiringPosition() {
    var safe = cost(5, 0, 1, 24);
    var close = cost(1, 5, 3, 6);
    assertThat(close).isGreaterThan(safe);
  }
}
