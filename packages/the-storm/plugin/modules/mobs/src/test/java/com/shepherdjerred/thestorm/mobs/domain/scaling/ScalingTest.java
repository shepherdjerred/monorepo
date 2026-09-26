package com.shepherdjerred.thestorm.mobs.domain.scaling;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.mobs.testing.FixedRandom;
import java.util.EnumMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

final class ScalingTest {

  static Map<Stat, Double> all(double value) {
    var map = new EnumMap<Stat, Double>(Stat.class);
    for (var stat : Stat.values()) {
      map.put(stat, value);
    }
    return map;
  }

  static final Scaling SCALING =
      new Scaling(
          all(1.1),
          Map.of(
              "enderman", Map.of(Stat.MAX_HEALTH, 0.0, Stat.MOVEMENT_SPEED, 0.0),
              "creeper", Map.of(Stat.MOVEMENT_SPEED, 0.025)));

  @ParameterizedTest
  @CsvSource({"1, 0", "50, 1.1", "2, 0.022449", "25, 0.538776", "49, 1.077551"})
  void bonusesGrowEvenlyFromNothingAtLevelOneToTheFullValueAtTheCap(int level, double bonus) {
    assertThat(SCALING.bonus(Stat.MAX_HEALTH, "zombie", level, 50)).isCloseTo(bonus, within(1e-6));
  }

  @Test
  void typeOverridesReplaceOnlyTheStatsTheyName() {
    assertThat(SCALING.bonus(Stat.MAX_HEALTH, "enderman", 50, 50)).isZero();
    assertThat(SCALING.bonus(Stat.MOVEMENT_SPEED, "enderman", 50, 50)).isZero();
    assertThat(SCALING.bonus(Stat.ATTACK_DAMAGE, "enderman", 50, 50)).isEqualTo(1.1);
    assertThat(SCALING.atCap(Stat.MOVEMENT_SPEED, "creeper")).isEqualTo(0.025);
    assertThat(SCALING.atCap(Stat.MAX_HEALTH, "creeper")).isEqualTo(1.1);
  }

  @Test
  void levelsOutsideTheRangeAreBugs() {
    assertThatThrownBy(() -> SCALING.bonus(Stat.XP, "zombie", 0, 50)).hasMessageContaining("1-50");
    assertThatThrownBy(() -> SCALING.bonus(Stat.XP, "zombie", 51, 50)).hasMessageContaining("1-50");
    assertThatThrownBy(() -> SCALING.bonus(Stat.XP, "zombie", 1, 1)).hasMessageContaining("1-1");
  }

  @Test
  void everyStatMustBeGivenAndNonNegative() {
    var missing = all(1.0);
    missing.remove(Stat.ARMOR);
    assertThatThrownBy(() -> new Scaling(missing, Map.of())).hasMessageContaining("ARMOR");
    var negative = all(1.0);
    negative.put(Stat.XP, -0.5);
    assertThatThrownBy(() -> new Scaling(negative, Map.of())).hasMessageContaining("XP");
    assertThatThrownBy(() -> new Scaling(all(1.0), Map.of("zombie", Map.of(Stat.XP, Double.NaN))))
        .hasMessageContaining("XP");
    assertThatThrownBy(() -> new Scaling(all(1.0), Map.of("Zombie", Map.of())))
        .hasMessageContaining("lowercase");
  }

  @Test
  void statsSayHowTheyAreRead() {
    assertThat(Stat.ARMOR.kind()).isEqualTo(Stat.Kind.POINTS);
    assertThat(Stat.ARMOR_TOUGHNESS.kind()).isEqualTo(Stat.Kind.POINTS);
    assertThat(Stat.MAX_HEALTH.kind()).isEqualTo(Stat.Kind.SHARE);
  }

  @ParameterizedTest
  @CsvSource({
    // base, bonus, random point, xp
    "5, 0, 0, 5",
    "5, 1.0, 0, 10",
    "5, 0.5, 0, 8",
    "5, 0.5, 0.49, 8",
    "5, 0.5, 0.5, 7",
    "0, 3.0, 0, 0",
    "1, 0.5, 0.2, 2",
  })
  void experienceRoundsFractionsUpWithTheirOwnProbability(
      int base, double bonus, double point, int xp) {
    assertThat(Rewards.xp(base, bonus, FixedRandom.at(point))).isEqualTo(xp);
  }

  @ParameterizedTest
  @CsvSource({
    // bonus, random point, extra rolls
    "0, 0, 0",
    "0.5, 0.49, 1",
    "0.5, 0.5, 0",
    "1.0, 0.99, 1",
    "1.5, 0.2, 2",
    "1.5, 0.7, 1",
  })
  void extraLootRollsRoundTheBonusWithItsOwnProbability(double bonus, double point, int rolls) {
    assertThat(Rewards.extraRolls(bonus, FixedRandom.at(point))).isEqualTo(rolls);
  }

  @ParameterizedTest
  @CsvSource({
    // player damage, other damage, player final blow, earned
    "20, 0, true, true",
    "11, 9, true, true",
    "10, 10, true, false",
    "5, 15, true, false",
    "20, 0, false, false",
    "0, 0, true, false",
  })
  void onlyAKillPlayersMostlyEarnedPaysMore(
      double player, double other, boolean finalBlow, boolean earned) {
    assertThat(Rewards.earned(player, other, finalBlow)).isEqualTo(earned);
  }

  @Test
  void rewardsRejectNonsense() {
    var random = FixedRandom.lowest();
    assertThatThrownBy(() -> Rewards.xp(-1, 0, random)).hasMessageContaining("negative");
    assertThatThrownBy(() -> Rewards.xp(1, -1, random)).hasMessageContaining("bonus");
    assertThatThrownBy(() -> Rewards.extraRolls(Double.POSITIVE_INFINITY, random))
        .hasMessageContaining("bonus");
    assertThatThrownBy(() -> Rewards.earned(-1, 0, true)).hasMessageContaining("negative");
    assertThatThrownBy(() -> Rewards.earned(0, Double.NaN, true)).hasMessageContaining("negative");
  }
}
