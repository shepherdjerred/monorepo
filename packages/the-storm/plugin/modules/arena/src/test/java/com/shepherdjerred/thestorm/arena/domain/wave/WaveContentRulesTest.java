package com.shepherdjerred.thestorm.arena.domain.wave;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.arena.domain.kit.Slot;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalDouble;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/** The rules archetypes, abilities, bosses and spawn groups enforce on themselves. */
final class WaveContentRulesTest {

  /** An ability's tuning, as written in content. */
  private record Tuning(double radius, double power, int count, @Nullable String summon) {}

  private static AbilitySpec ability(AbilityType type, Tuning tuning) {
    return new AbilitySpec(
        type,
        Duration.ofSeconds(10),
        tuning.radius(),
        tuning.power(),
        tuning.count(),
        Optional.ofNullable(tuning.summon()));
  }

  private static AbilitySpec ability(AbilityType type, double radius, double power, int count) {
    return ability(type, new Tuning(radius, power, count, null));
  }

  @Test
  void eachAbilityTakesExactlyTheParametersItUses() {
    ability(AbilityType.LIGHTNING_AURA, 5, 4, 0);
    ability(AbilityType.CHAIN_LIGHTNING, 8, 4, 2);
    ability(AbilityType.DISORIENT, 5, 3, 0);
    ability(AbilityType.SUMMON_ADDS, new Tuning(0, 0, 3, "zombie"));
    ability(AbilityType.KNOCKBACK_SLAM, 4, 1.5, 0);
    ability(AbilityType.SHIELD_BREAK, 5, 5, 0);
    ability(AbilityType.HEART, 0, 0.25, 5);
  }

  /** A wrong tuning for a type, and the parameter the error must name. */
  private record Wrong(AbilityType type, Tuning tuning, String named) {}

  static List<Wrong> wrongTunings() {
    return List.of(
        new Wrong(AbilityType.LIGHTNING_AURA, new Tuning(0, 4, 0, null), "radius"),
        new Wrong(AbilityType.LIGHTNING_AURA, new Tuning(5, 4, 2, null), "count"),
        new Wrong(AbilityType.CHAIN_LIGHTNING, new Tuning(8, 4, 0, null), "count"),
        new Wrong(AbilityType.CHAIN_LIGHTNING, new Tuning(8, 4, 21, null), "count"),
        new Wrong(AbilityType.DISORIENT, new Tuning(5, 0, 0, null), "power"),
        new Wrong(AbilityType.SUMMON_ADDS, new Tuning(0, 0, 3, null), "summon"),
        new Wrong(AbilityType.SUMMON_ADDS, new Tuning(2, 0, 3, "zombie"), "radius"),
        new Wrong(AbilityType.SUMMON_ADDS, new Tuning(0, 1, 3, "zombie"), "power"),
        new Wrong(AbilityType.KNOCKBACK_SLAM, new Tuning(4, 1, 0, "zombie"), "summon"),
        new Wrong(AbilityType.SHIELD_BREAK, new Tuning(65, 5, 0, null), "radius"),
        new Wrong(AbilityType.HEART, new Tuning(0, 1.5, 5, null), "power"),
        new Wrong(AbilityType.HEART, new Tuning(0, 0.25, 0, null), "count"));
  }

  @MethodSource("wrongTunings")
  @ParameterizedTest
  void wrongParametersAreRejected(Wrong wrong) {
    assertThatThrownBy(() -> ability(wrong.type(), wrong.tuning()))
        .hasMessageContaining(wrong.named());
  }

  @Test
  void cooldownsAreAtLeastASecond() {
    assertThatThrownBy(
            () ->
                new AbilitySpec(
                    AbilityType.DISORIENT, Duration.ofMillis(500), 5, 3, 0, Optional.empty()))
        .hasMessageContaining("cooldown");
  }

  @Test
  void aBossHasAtMostOneHeart() {
    var heart = ability(AbilityType.HEART, 0, 0.25, 5);

    assertThat(
            new BossDefinition("creaking", "Heartwood", 200, BarColor.GREEN, List.of(heart))
                .hasHeart())
        .isTrue();
    assertThat(new BossDefinition("zombie", "King", 200, BarColor.GREEN, List.of()).hasHeart())
        .isFalse();
    assertThatThrownBy(
            () ->
                new BossDefinition(
                    "creaking", "Heartwood", 200, BarColor.GREEN, List.of(heart, heart)))
        .hasMessageContaining("one heart");
    assertThatThrownBy(() -> new BossDefinition("zombie", " ", 200, BarColor.GREEN, List.of()))
        .hasMessageContaining("name");
    assertThatThrownBy(() -> new BossDefinition("zombie", "King", 2000, BarColor.GREEN, List.of()))
        .hasMessageContaining("health");
  }

  @Test
  void kamikazeMobsNeedABlastAndOthersMustNotHaveOne() {
    assertThatThrownBy(
            () ->
                new MobArchetype(
                    "SHEEP",
                    1,
                    1,
                    1,
                    1,
                    Optional.empty(),
                    Map.of(),
                    Optional.empty(),
                    Behavior.KAMIKAZE,
                    0))
        .hasMessageContaining("blast");
    assertThatThrownBy(
            () ->
                new MobArchetype(
                    "SHEEP",
                    1,
                    1,
                    1,
                    1,
                    Optional.empty(),
                    Map.of(),
                    Optional.empty(),
                    Behavior.CHASE,
                    2))
        .hasMessageContaining("blast");
  }

  @Test
  void archetypesStayInsideTheGamesLimits() {
    assertThatThrownBy(() -> archetype("zombie", 1, 1)).hasMessageContaining("type");
    assertThatThrownBy(() -> archetype("ZOMBIE", 0, 1)).hasMessageContaining("health");
    assertThatThrownBy(() -> archetype("ZOMBIE", 1, 17)).hasMessageContaining("scale");
    assertThatThrownBy(() -> archetype("ZOMBIE", 1, 0.01)).hasMessageContaining("scale");
    assertThatThrownBy(
            () ->
                new MobArchetype(
                    "ZOMBIE",
                    1,
                    1,
                    1,
                    1,
                    Optional.empty(),
                    Map.of(Slot.HEAD, "iron_helmet"),
                    Optional.empty(),
                    Behavior.VANILLA,
                    0))
        .hasMessageContaining("equipment");
    assertThatThrownBy(
            () ->
                new MobArchetype(
                    "ZOMBIE",
                    1,
                    1,
                    1,
                    1,
                    Optional.of(""),
                    Map.of(),
                    Optional.empty(),
                    Behavior.VANILLA,
                    0))
        .hasMessageContaining("name");
    assertThat(archetype("ZOMBIE", 1, 4).scale()).isEqualTo(4);
  }

  private static MobArchetype archetype(String type, double health, double scale) {
    return new MobArchetype(
        type,
        health,
        1,
        1,
        scale,
        Optional.empty(),
        Map.of(),
        Optional.empty(),
        Behavior.VANILLA,
        0);
  }

  @Test
  void spawnGroupsNeedSensibleCounts() {
    assertThatThrownBy(() -> new SpawnGroup("zombie", 0, 0)).hasMessageContaining("count");
    assertThatThrownBy(() -> new SpawnGroup("zombie", 1, -1)).hasMessageContaining("growth");
  }

  @Test
  void theMobBrainDecidesEachSecond() {
    var near = OptionalDouble.of(2);
    var far = OptionalDouble.of(10);
    var none = OptionalDouble.empty();

    assertThat(MobBrain.decide(Behavior.VANILLA, near)).isEqualTo(MobBrain.Action.NOTHING);
    assertThat(MobBrain.decide(Behavior.CHASE, far)).isEqualTo(MobBrain.Action.HUNT);
    assertThat(MobBrain.decide(Behavior.KAMIKAZE, far)).isEqualTo(MobBrain.Action.HUNT);
    assertThat(MobBrain.decide(Behavior.KAMIKAZE, near)).isEqualTo(MobBrain.Action.DETONATE);
    assertThat(MobBrain.decide(Behavior.KAMIKAZE, OptionalDouble.of(MobBrain.DETONATE_RANGE)))
        .isEqualTo(MobBrain.Action.DETONATE);
    assertThat(MobBrain.decide(Behavior.FOLLOW, far)).isEqualTo(MobBrain.Action.APPROACH);
    assertThat(MobBrain.decide(Behavior.FOLLOW, near)).isEqualTo(MobBrain.Action.NOTHING);
    for (var behavior : Behavior.values()) {
      assertThat(MobBrain.decide(behavior, none)).isEqualTo(MobBrain.Action.NOTHING);
    }
  }

  @Test
  void tiersAndScalingStayInRange() {
    assertThatThrownBy(() -> new Tier("", 1, 1, 1, 1)).hasMessageContaining("name");
    assertThatThrownBy(() -> new Tier("I", 0, 1, 1, 1)).hasMessageContaining("health");
    assertThatThrownBy(() -> new Scaling(-0.1, 0, 0, 0, 0)).hasMessageContaining("healthPerWave");
    assertThatThrownBy(() -> new Scaling(0, 0, 0, 0, 6))
        .hasMessageContaining("bossHealthPerExtraPlayer");
  }
}
