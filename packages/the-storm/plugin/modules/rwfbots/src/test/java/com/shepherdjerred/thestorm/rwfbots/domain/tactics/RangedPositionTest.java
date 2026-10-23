package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
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
  void aSharpArchersBandDoesNotPullItInFromALongFiringPosition() {
    var sharp = ArchetypeBias.keep(Kit.LONGBOW, Archetype.TACTICIAN, levers(1));
    var weak = ArchetypeBias.keep(Kit.LONGBOW, Archetype.TACTICIAN, levers(0));
    var near = new RangedPosition.Candidate(3, 0, 2, 24);
    var far = new RangedPosition.Candidate(3, 0, 2, 45);
    assertThat(RangedPosition.cost(far, sharp)).isEqualTo(RangedPosition.cost(near, sharp));
    assertThat(RangedPosition.cost(far, weak)).isGreaterThan(RangedPosition.cost(near, weak));
  }

  @Test
  void beingAboveTheEnemyDoesNotMakeChargingIntoMeleeAUsefulFiringPosition() {
    var safe = cost(5, 0, 1, 24);
    var close = cost(1, 5, 3, 6);
    assertThat(close).isGreaterThan(safe);
  }
}
