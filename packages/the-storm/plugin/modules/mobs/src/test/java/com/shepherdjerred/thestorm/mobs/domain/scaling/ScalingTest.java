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
    // amount, bonus, random point, result (in stacks of 64)
    "2, 1.0, 0, 4",
    "2, 0.25, 0.6, 2",
    "2, 0.25, 0.4, 3",
    "40, 1.0, 0, 64",
    "64, 2.0, 0, 64",
    "3, 0, 0, 3",
  })
  void stackableDropsGrowButNeverPastAFullStack(
      int amount, double bonus, double point, int result) {
    assertThat(Rewards.dropAmount(amount, 64, bonus, FixedRandom.at(point))).isEqualTo(result);
  }

  @Test
  void unstackableDropsAreNeverCopiedAndSmallStacksCapAtTheirSize() {
    assertThat(Rewards.dropAmount(1, 1, 2.0, FixedRandom.lowest())).isEqualTo(1);
    assertThat(Rewards.dropAmount(3, 16, 1.0, FixedRandom.lowest())).isEqualTo(6);
    assertThat(Rewards.dropAmount(12, 16, 1.0, FixedRandom.lowest())).isEqualTo(16);
  }

  @Test
  void rewardsRejectNonsense() {
    var random = FixedRandom.lowest();
    assertThatThrownBy(() -> Rewards.xp(-1, 0, random)).hasMessageContaining("negative");
    assertThatThrownBy(() -> Rewards.xp(1, -1, random)).hasMessageContaining("bonus");
    assertThatThrownBy(() -> Rewards.dropAmount(0, 64, 0, random)).hasMessageContaining("positive");
    assertThatThrownBy(() -> Rewards.dropAmount(1, 64, Double.POSITIVE_INFINITY, random))
        .hasMessageContaining("bonus");
  }
}
