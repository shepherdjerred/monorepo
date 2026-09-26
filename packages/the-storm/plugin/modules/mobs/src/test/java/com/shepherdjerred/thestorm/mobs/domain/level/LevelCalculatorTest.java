package com.shepherdjerred.thestorm.mobs.domain.level;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.mobs.testing.FixedRandom;
import java.util.List;
import java.util.Map;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

final class LevelCalculatorTest {

  static final long NOON = 6_000;
  static final long MIDNIGHT = 18_000;
  static final int SURFACE = 70;
  static final int FULL_MOON = 0;
  static final int NEW_MOON = 4;

  static final List<DistanceBand> BANDS =
      List.of(
          new DistanceBand(0, 1, 1),
          new DistanceBand(300, 1, 3),
          new DistanceBand(1000, 3, 8),
          new DistanceBand(5000, 15, 25),
          new DistanceBand(30000, 45, 50));

  static final List<Integer> MOON = List.of(2, 1, 0, 0, 0, 0, 0, 1);

  static LevelRules rules(int cap) {
    return new LevelRules(
        cap,
        BANDS,
        Map.of(
            "world", new WorldRule(1.0, true, true),
            "world_nether", new WorldRule(8.0, false, false)),
        new DepthRule(62, 5, 0.05),
        MOON);
  }

  static final LevelCalculator CALCULATOR = new LevelCalculator(rules(50));

  static Levelled level(SpawnSite site, FixedRandom random) {
    return CALCULATOR.level(site, random).orElseThrow();
  }

  static SpawnSite surface(double distance) {
    return new SpawnSite("world", distance, SURFACE, NEW_MOON, NOON);
  }

  @ParameterizedTest
  @CsvSource({
    "0, 1, 1",
    "299.99, 1, 1",
    "300, 1, 3",
    "999.99, 1, 3",
    "1000, 3, 8",
    "4999, 3, 8",
    "5000, 15, 25",
    "29999.9, 15, 25",
    "30000, 45, 50",
    "1000000, 45, 50",
  })
  void theDistanceBandSetsTheRangeAtItsInnerEdge(double distance, int lowest, int highest) {
    assertThat(level(surface(distance), FixedRandom.lowest()).level()).isEqualTo(lowest);
    assertThat(level(surface(distance), FixedRandom.highest()).level()).isEqualTo(highest);
  }

  @Test
  void levelsInABandAreDrawnFromTheWholeRange() {
    var random = new SplittableRandom(7);
    var seen = new java.util.TreeSet<Integer>();
    for (var i = 0; i < 500; i++) {
      seen.add(CALCULATOR.level(surface(1500), random).orElseThrow().level());
    }
    assertThat(seen).containsExactly(3, 4, 5, 6, 7, 8);
  }

  @Test
  void theNetherCountsDistanceEightTimes() {
    var nether = new SpawnSite("world_nether", 125, SURFACE, NEW_MOON, NOON);
    assertThat(level(nether, FixedRandom.lowest()).level()).isEqualTo(3);
    var nearer = new SpawnSite("world_nether", 124.9, SURFACE, NEW_MOON, NOON);
    assertThat(level(nearer, FixedRandom.highest()).level()).isEqualTo(3);
  }

  @Test
  void worldsWithoutARuleNeverLevelMobs() {
    var end = new SpawnSite("world_the_end", 1000, SURFACE, FULL_MOON, MIDNIGHT);
    assertThat(CALCULATOR.level(end, FixedRandom.lowest())).isEmpty();
  }

  @ParameterizedTest
  @CsvSource({
    // y, distance level, depth bonus
    "62, 10, 0",
    "100, 10, 0",
    "61, 10, 0",
    "57, 10, 0",
    "22, 10, 4",
    "-58, 10, 12",
    "-64, 1, 1",
    "-64, 3, 3",
    "0, 1, 0",
  })
  void depthAddsTheBlendedShareOfTheDistanceLevel(int y, int base, int bonus) {
    assertThat(new DepthRule(62, 5, 0.05).bonus(y, base)).isEqualTo(bonus);
  }

  @Test
  void depthOnlyCountsInWorldsThatUseIt() {
    var deep = new SpawnSite("world", 1000, -58, NEW_MOON, NOON);
    assertThat(level(deep, FixedRandom.lowest())).isEqualTo(new Levelled(3, 3, 0, 6));
    var deepNether = new SpawnSite("world_nether", 125, 10, NEW_MOON, NOON);
    assertThat(level(deepNether, FixedRandom.lowest())).isEqualTo(new Levelled(3, 0, 0, 3));
  }

  @ParameterizedTest
  @CsvSource({
    "12999, 0",
    "13000, 2",
    "18000, 2",
    "22999, 2",
    "23000, 0",
    "0, 0",
  })
  void theFullMoonAddsLevelsOnlyAtNight(long time, int bonus) {
    var site = new SpawnSite("world", 0, SURFACE, FULL_MOON, time);
    assertThat(level(site, FixedRandom.lowest()).moonBonus()).isEqualTo(bonus);
  }

  @ParameterizedTest
  @CsvSource({"0, 2", "1, 1", "2, 0", "4, 0", "7, 1"})
  void eachMoonPhaseHasItsOwnBonus(int phase, int bonus) {
    var site = new SpawnSite("world", 0, SURFACE, phase, MIDNIGHT);
    assertThat(level(site, FixedRandom.lowest())).isEqualTo(new Levelled(1, 0, bonus, 1 + bonus));
  }

  @Test
  void theMoonOnlyCountsInWorldsThatUseIt() {
    var nether = new SpawnSite("world_nether", 0, SURFACE, FULL_MOON, MIDNIGHT);
    assertThat(level(nether, FixedRandom.lowest()).moonBonus()).isZero();
  }

  @Test
  void theSumIsCappedAtTheLevelCap() {
    var farDeepFullMoon = new SpawnSite("world", 40_000, -64, FULL_MOON, MIDNIGHT);
    var levelled = level(farDeepFullMoon, FixedRandom.highest());
    assertThat(levelled.distanceLevel()).isEqualTo(50);
    assertThat(levelled.depthBonus()).isEqualTo(63);
    assertThat(levelled.level()).isEqualTo(50);
  }

  @Test
  void aSmallerCapStillHoldsEverything() {
    var small =
        new LevelRules(
            5,
            List.of(new DistanceBand(0, 1, 5)),
            Map.of("world", new WorldRule(1, true, true)),
            new DepthRule(62, 5, 0.05),
            MOON);
    var site = new SpawnSite("world", 0, -64, FULL_MOON, MIDNIGHT);
    assertThat(new LevelCalculator(small).level(site, FixedRandom.highest()).orElseThrow().level())
        .isEqualTo(5);
    assertThat(new LevelCalculator(small).cap()).isEqualTo(5);
  }

  @Test
  void bandsMustStartAtZeroAndGrowOutward() {
    var world = Map.of("world", new WorldRule(1, true, true));
    var depth = new DepthRule(62, 5, 0.05);
    assertThatThrownBy(
            () -> new LevelRules(50, List.of(new DistanceBand(10, 1, 1)), world, depth, MOON))
        .hasMessageContaining("start with a band from 0");
    assertThatThrownBy(() -> new LevelRules(50, List.of(), world, depth, MOON))
        .hasMessageContaining("start with a band from 0");
    assertThatThrownBy(
            () ->
                new LevelRules(
                    50,
                    List.of(
                        new DistanceBand(0, 1, 1),
                        new DistanceBand(500, 1, 2),
                        new DistanceBand(500, 2, 3)),
                    world,
                    depth,
                    MOON))
        .hasMessageContaining("ordered by from");
    assertThatThrownBy(
            () -> new LevelRules(10, List.of(new DistanceBand(0, 1, 11)), world, depth, MOON))
        .hasMessageContaining("above the cap");
  }

  @Test
  void rulesRejectBadCapsAndMoons() {
    var bands = List.of(new DistanceBand(0, 1, 1));
    var world = Map.of("world", new WorldRule(1, true, true));
    var depth = new DepthRule(62, 5, 0.05);
    assertThatThrownBy(() -> new LevelRules(1, bands, world, depth, MOON))
        .hasMessageContaining("cap");
    assertThatThrownBy(() -> new LevelRules(1001, bands, world, depth, MOON))
        .hasMessageContaining("cap");
    assertThatThrownBy(() -> new LevelRules(50, bands, world, depth, List.of(1, 2, 3)))
        .hasMessageContaining("8 entries");
    assertThatThrownBy(
            () -> new LevelRules(50, bands, world, depth, List.of(0, 0, 0, 0, -1, 0, 0, 0)))
        .hasMessageContaining("moon bonuses");
  }

  @Test
  void partsRejectNonsense() {
    assertThatThrownBy(() -> new DistanceBand(-1, 1, 1)).hasMessageContaining("negative");
    assertThatThrownBy(() -> new DistanceBand(0, 0, 1)).hasMessageContaining("min");
    assertThatThrownBy(() -> new DistanceBand(0, 3, 2)).hasMessageContaining("min");
    assertThatThrownBy(() -> new WorldRule(0, true, true)).hasMessageContaining("positive");
    assertThatThrownBy(() -> new WorldRule(Double.NaN, true, true))
        .hasMessageContaining("positive");
    assertThatThrownBy(() -> new DepthRule(62, 0, 0.05)).hasMessageContaining("period");
    assertThatThrownBy(() -> new DepthRule(62, 5, -0.1)).hasMessageContaining("multiplier");
    assertThatThrownBy(() -> new SpawnSite("world", -1, 0, 0, 0)).hasMessageContaining("distance");
    assertThatThrownBy(() -> new SpawnSite("world", 0, 0, 8, 0)).hasMessageContaining("moonPhase");
    assertThatThrownBy(() -> new SpawnSite("world", 0, 0, 0, 24_000))
        .hasMessageContaining("timeOfDay");
    assertThatThrownBy(() -> new Levelled(0, 0, 0, 0)).hasMessageContaining("level");
  }
}
