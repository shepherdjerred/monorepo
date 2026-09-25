package com.shepherdjerred.thestorm.arena.domain.wave;

import static com.shepherdjerred.thestorm.arena.testing.Samples.FLAT;
import static com.shepherdjerred.thestorm.arena.testing.Samples.NO_SCALING;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.arena.testing.Samples;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

final class WaveScalingTest {

  private static final Scaling SCALING = new Scaling(0.02, 0.01, 0.2, 0.4, 0.35);
  private static final Tier HARD = new Tier("Ominous V", 1.75, 1.5, 1.4, 2.0);

  /** A spawn group on some wave of its range, for some players, and how many it spawns. */
  private record CountCase(int count, double growth, int steps, int players, int expected) {}

  static List<CountCase> counts() {
    return List.of(
        new CountCase(3, 0, 0, 1, 3),
        new CountCase(3, 1, 2, 1, 5),
        new CountCase(2, 0.5, 1, 1, 3),
        // 3 * 1.4 = 4.2, rounded up
        new CountCase(3, 0, 0, 2, 5),
        // 3 * 1.8 = 5.4, rounded up
        new CountCase(3, 0, 0, 3, 6),
        // 5 * 1.4 is exactly 7 despite floating point
        new CountCase(5, 0, 0, 2, 7));
  }

  @MethodSource("counts")
  @ParameterizedTest
  void countsGrowWithTheRangeAndThePlayers(CountCase row) {
    var group = new SpawnGroup("zombie", row.count(), row.growth());
    var difficulty = new Difficulty(row.players(), FLAT, SCALING);

    assertThat(WaveScaling.count(group, row.steps(), difficulty)).isEqualTo(row.expected());
  }

  @Test
  void theTierMultipliesTheCount() {
    var group = new SpawnGroup("zombie", 5, 0);

    assertThat(WaveScaling.count(group, 0, new Difficulty(1, HARD, SCALING))).isEqualTo(7);
  }

  @Test
  void rangesCannotBeWalkedBackwards() {
    assertThatThrownBy(
            () ->
                WaveScaling.count(new SpawnGroup("z", 1, 0), -1, new Difficulty(1, FLAT, SCALING)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void aSoloPlayerOnWaveOneFacesBaselineMobs() {
    var zombie = Samples.mob("ZOMBIE");
    var solo = new Difficulty(1, FLAT, SCALING);

    assertThat(WaveScaling.mobHealth(zombie, 1, WaveKind.STANDARD, solo)).isEqualTo(1);
    assertThat(WaveScaling.damage(zombie, 1, solo)).isEqualTo(1);
  }

  @Test
  void healthGrowsWithWavesPlayersAndTier() {
    var zombie = Samples.mob("ZOMBIE");

    assertThat(
            WaveScaling.mobHealth(zombie, 72, WaveKind.STANDARD, new Difficulty(1, FLAT, SCALING)))
        .isCloseTo(2.42, within(1e-9));
    assertThat(
            WaveScaling.mobHealth(zombie, 1, WaveKind.STANDARD, new Difficulty(3, FLAT, SCALING)))
        .isCloseTo(1.4, within(1e-9));
    assertThat(
            WaveScaling.mobHealth(zombie, 1, WaveKind.STANDARD, new Difficulty(1, HARD, SCALING)))
        .isCloseTo(1.75, within(1e-9));
  }

  @Test
  void swarmsGetNoExtraHealthForExtraPlayers() {
    var vex = Samples.mob("VEX");

    assertThat(WaveScaling.mobHealth(vex, 1, WaveKind.SWARM, new Difficulty(3, FLAT, SCALING)))
        .isEqualTo(1);
  }

  @Test
  void damageGrowsWithWavesAndTierButNotPlayers() {
    var zombie = Samples.mob("ZOMBIE");

    assertThat(WaveScaling.damage(zombie, 72, new Difficulty(3, FLAT, SCALING)))
        .isCloseTo(1.71, within(1e-9));
    assertThat(WaveScaling.damage(zombie, 1, new Difficulty(1, HARD, SCALING))).isEqualTo(1.5);
  }

  @Test
  void bossHealthScalesWithPlayersAndTierAndIsCapped() {
    var boss = new BossDefinition("zombie", "King", 400, BarColor.RED, List.of());

    assertThat(WaveScaling.bossHealth(boss, new Difficulty(1, FLAT, SCALING))).isEqualTo(400);
    assertThat(WaveScaling.bossHealth(boss, new Difficulty(2, FLAT, SCALING)))
        .isCloseTo(540, within(1e-9));
    assertThat(WaveScaling.bossHealth(boss, new Difficulty(3, HARD, SCALING)))
        .isEqualTo(WaveScaling.MAX_HEALTH);
  }

  @Test
  void absoluteHealthIsCappedAndAtLeastOne() {
    assertThat(WaveScaling.absoluteHealth(20, 1.5)).isEqualTo(30);
    assertThat(WaveScaling.absoluteHealth(500, 3)).isEqualTo(WaveScaling.MAX_HEALTH);
    assertThat(WaveScaling.absoluteHealth(8, 0.05)).isEqualTo(1);
  }

  @Test
  void noScalingMeansNoChange() {
    var solo = new Difficulty(3, FLAT, NO_SCALING);

    assertThat(WaveScaling.count(new SpawnGroup("z", 4, 0), 0, solo)).isEqualTo(4);
  }

  @Test
  void aWaveNeedsAPlayer() {
    assertThatThrownBy(() -> new Difficulty(0, FLAT, SCALING))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
