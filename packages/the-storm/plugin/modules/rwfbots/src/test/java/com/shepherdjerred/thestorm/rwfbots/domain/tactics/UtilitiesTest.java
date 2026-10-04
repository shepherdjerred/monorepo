package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static java.util.Comparator.comparingDouble;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class UtilitiesTest {

  private static final Utilities.Temper TEMPER =
      new Utilities.Temper(new Style(0.5, 0.5, 0.5, 0.5), 0.5, Role.PLANT);

  private static Features features(boolean ownBombLit, boolean inPoison, double enemyDistance) {
    return new Features(
        1.0,
        enemyDistance,
        Double.isFinite(enemyDistance) ? 1 : 0,
        Double.isFinite(enemyDistance) ? 1 : 0,
        Double.isFinite(enemyDistance) ? 1 : 0,
        1,
        2,
        ownBombLit,
        6,
        30,
        false,
        false,
        inPoison,
        inPoison ? 0.5 : 0,
        inPoison,
        true,
        false);
  }

  private static Option best(Map<Option, Double> scores) {
    return scores.entrySet().stream()
        .max(comparingDouble(entry -> entry.getValue().doubleValue()))
        .orElseThrow()
        .getKey();
  }

  @Test
  void aLitOwnBombMakesDefuseTheTopPriority() {
    assertThat(best(Utilities.score(features(true, false, 10), TEMPER))).isEqualTo(Option.DEFUSE);
  }

  @Test
  void poisonAtTheOwnBombMustBeLeft() {
    assertThat(best(Utilities.score(features(false, true, Double.POSITIVE_INFINITY), TEMPER)))
        .isEqualTo(Option.ESCAPE_POISON);
  }

  @Test
  void aPlanterWithNoEnemyInSightGoesToArm() {
    assertThat(best(Utilities.score(features(false, false, Double.POSITIVE_INFINITY), TEMPER)))
        .isEqualTo(Option.ARM);
  }

  @Test
  void aStackedFuseDrawsHelpers() {
    var f =
        new Features(
            1,
            Double.POSITIVE_INFINITY,
            0,
            0,
            0,
            2,
            2,
            false,
            40,
            10,
            true,
            false,
            false,
            0,
            false,
            true,
            false);
    assertThat(
            best(
                Utilities.score(
                    f, new Utilities.Temper(new Style(0.5, 0.5, 0.5, 0.5), 0.5, Role.ESCORT))))
        .isEqualTo(Option.HELP_ARM);
  }

  @Test
  void aggressionRisesWithPoison() {
    var calm = Utilities.score(features(false, false, 10), TEMPER).get(Option.ENGAGE);
    var late =
        Utilities.score(
                new Features(
                    1, 10, 1, 1, 1, 1, 2, false, 40, 30, false, false, true, 2, false, true, false),
                TEMPER)
            .get(Option.ENGAGE);
    assertThat(late).isGreaterThan(calm);
  }
}
