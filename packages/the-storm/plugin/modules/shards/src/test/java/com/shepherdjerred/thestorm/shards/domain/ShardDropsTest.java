package com.shepherdjerred.thestorm.shards.domain;

import static com.shepherdjerred.thestorm.shards.domain.Fixtures.NETHER;
import static com.shepherdjerred.thestorm.shards.domain.Fixtures.OVERWORLD;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.shards.domain.DropOutcome.Dropped;
import com.shepherdjerred.thestorm.shards.domain.DropOutcome.Nothing;
import com.shepherdjerred.thestorm.shards.domain.DropOutcome.Reason;
import java.util.List;
import java.util.Map;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

final class ShardDropsTest {

  private final ShardDrops drops = new ShardDrops(Fixtures.drops());

  private static BlockBreak natural(String material) {
    return new BlockBreak(material, OVERWORLD, false, false, true);
  }

  private static MobKill kill(String type) {
    return new MobKill(type, OVERWORLD, "NATURAL", true);
  }

  @Test
  void aRollUnderTheChanceDropsBetweenMinAndMax() {
    var random = ScriptedRandom.rolls(0.0074).thenInt(2);

    assertThat(drops.evaluate(natural("DIAMOND_ORE"), random)).isEqualTo(new Dropped(2));
    assertThat(random.exhausted()).isTrue();
  }

  @Test
  void aRollAtTheChanceMisses() {
    assertThat(drops.evaluate(natural("DIAMOND_ORE"), ScriptedRandom.rolls(0.0075)))
        .isEqualTo(new Nothing(Reason.UNLUCKY));
  }

  @Test
  void deepslateVariantsAreTheirOwnSources() {
    var random = ScriptedRandom.rolls(0.0).thenInt(1);

    assertThat(drops.evaluate(natural("DEEPSLATE_DIAMOND_ORE"), random)).isEqualTo(new Dropped(1));
  }

  @Test
  void aFixedAmountNeedsNoSecondRoll() {
    var random = ScriptedRandom.rolls(0.0);

    assertThat(drops.evaluate(kill("ZOMBIE"), random)).isEqualTo(new Dropped(1));
    assertThat(random.exhausted()).isTrue();
  }

  @Test
  void bossesDropMore() {
    assertThat(drops.evaluate(kill("WARDEN"), ScriptedRandom.rolls(0.49).thenInt(2)))
        .isEqualTo(new Dropped(2));
  }

  @Test
  void placedOreNeverDrops() {
    var placed = new BlockBreak("DIAMOND_ORE", OVERWORLD, true, false, true);

    assertThat(drops.evaluate(placed, ScriptedRandom.rolls()))
        .isEqualTo(new Nothing(Reason.PLACED_BY_PLAYER));
  }

  @Test
  void silkTouchNeverDrops() {
    var silk = new BlockBreak("DIAMOND_ORE", OVERWORLD, false, true, true);

    assertThat(drops.evaluate(silk, ScriptedRandom.rolls()))
        .isEqualTo(new Nothing(Reason.SILK_TOUCH));
  }

  @Test
  void aBreakWithoutItemDropsNeverDrops() {
    var creative = new BlockBreak("DIAMOND_ORE", OVERWORLD, false, false, false);

    assertThat(drops.evaluate(creative, ScriptedRandom.rolls()))
        .isEqualTo(new Nothing(Reason.NO_ITEM_DROPS));
  }

  @Test
  void unlistedBlocksAndMobsAreNotSources() {
    assertThat(drops.evaluate(natural("STONE"), ScriptedRandom.rolls()))
        .isEqualTo(new Nothing(Reason.NOT_A_SOURCE));
    assertThat(drops.evaluate(kill("PIG"), ScriptedRandom.rolls()))
        .isEqualTo(new Nothing(Reason.NOT_A_SOURCE));
    assertThat(drops.isBlockSource("DIAMOND_ORE")).isTrue();
    assertThat(drops.isBlockSource("STONE")).isFalse();
    assertThat(drops.isMobSource("ZOMBIE")).isTrue();
    assertThat(drops.isMobSource("PIG")).isFalse();
  }

  @Test
  void worldsOutsideTheListNeverDrop() {
    var arena = new BlockBreak("DIAMOND_ORE", "thestorm:arena", false, false, true);

    assertThat(drops.evaluate(arena, ScriptedRandom.rolls()))
        .isEqualTo(new Nothing(Reason.WORLD_EXCLUDED));
    assertThat(
            drops.evaluate(
                new MobKill("ZOMBIE", "thestorm:arena", "NATURAL", true), ScriptedRandom.rolls()))
        .isEqualTo(new Nothing(Reason.WORLD_EXCLUDED));
  }

  @Test
  void listedWorldsAllDrop() {
    var nether = new MobKill("ZOMBIE", NETHER, "NATURAL", true);

    assertThat(drops.evaluate(nether, ScriptedRandom.rolls(0.0))).isEqualTo(new Dropped(1));
  }

  @Test
  void mobsNeedAPlayerKill() {
    var fell = new MobKill("ZOMBIE", OVERWORLD, "NATURAL", false);

    assertThat(drops.evaluate(fell, ScriptedRandom.rolls()))
        .isEqualTo(new Nothing(Reason.NOT_KILLED_BY_PLAYER));
  }

  @ParameterizedTest
  @ValueSource(strings = {"SPAWNER", "SPAWNER_EGG"})
  void artificialSpawnsNeverDrop(String reason) {
    var farmed = new MobKill("ZOMBIE", OVERWORLD, reason, true);

    assertThat(drops.evaluate(farmed, ScriptedRandom.rolls()))
        .isEqualTo(new Nothing(Reason.ARTIFICIAL_SPAWN));
  }

  @ParameterizedTest
  @ValueSource(strings = {"NATURAL", "TRIAL_SPAWNER", "BUILD_WITHER", "RAID"})
  void otherSpawnReasonsRoll(String reason) {
    var kill = new MobKill("ZOMBIE", OVERWORLD, reason, true);

    assertThat(drops.evaluate(kill, ScriptedRandom.rolls(0.0))).isEqualTo(new Dropped(1));
  }

  @Test
  void aSeededRandomDropsAtAboutTheConfiguredRate() {
    var random = new SplittableRandom(20150321L);
    var total = 200_000;
    var dropped = 0;
    var shards = 0;
    for (var i = 0; i < total; i++) {
      if (drops.evaluate(natural("DIAMOND_ORE"), random) instanceof Dropped(var amount)) {
        dropped++;
        shards += amount;
        assertThat(amount).isBetween(1, 2);
      }
    }
    assertThat((double) dropped / total).isCloseTo(0.0075, within(0.001));
    assertThat((double) shards / dropped).isCloseTo(1.5, within(0.1));
  }

  @Test
  void dropRulesValidateThemselves() {
    assertThatThrownBy(() -> new DropRule(0, 1, 1)).hasMessageContaining("chance");
    assertThatThrownBy(() -> new DropRule(1.5, 1, 1)).hasMessageContaining("chance");
    assertThatThrownBy(() -> new DropRule(Double.NaN, 1, 1)).hasMessageContaining("chance");
    assertThatThrownBy(() -> new DropRule(0.1, 0, 1)).hasMessageContaining("min");
    assertThatThrownBy(() -> new DropRule(0.1, 3, 2)).hasMessageContaining("max");
  }

  @Test
  void aCertainDropAlwaysDrops() {
    assertThat(new DropRule(1, 1, 1).roll(new SplittableRandom(1)).getAsInt()).isEqualTo(1);
  }

  @Test
  void dropsConfigValidatesItself() {
    var rule = new DropRule(0.1, 1, 1);
    assertThatThrownBy(
            () -> new DropsConfig(List.of(), List.of(), Map.of("ZOMBIE", rule), Map.of()))
        .hasMessageContaining("drops.worlds");
    assertThatThrownBy(
            () -> new DropsConfig(List.of("world"), List.of(), Map.of("ZOMBIE", rule), Map.of()))
        .hasMessageContaining("namespaced key");
    assertThatThrownBy(
            () ->
                new DropsConfig(
                    List.of(OVERWORLD, OVERWORLD), List.of(), Map.of("ZOMBIE", rule), Map.of()))
        .hasMessageContaining("repeat");
    assertThatThrownBy(
            () ->
                new DropsConfig(
                    List.of(OVERWORLD), List.of("spawner"), Map.of("ZOMBIE", rule), Map.of()))
        .hasMessageContaining("excludedSpawnReasons");
    assertThatThrownBy(
            () -> new DropsConfig(List.of(OVERWORLD), List.of(), Map.of("zombie", rule), Map.of()))
        .hasMessageContaining("drops.mobs");
    assertThatThrownBy(
            () ->
                new DropsConfig(
                    List.of(OVERWORLD), List.of(), Map.of(), Map.of("diamond_ore", rule)))
        .hasMessageContaining("drops.blocks");
    assertThatThrownBy(() -> new DropsConfig(List.of(OVERWORLD), List.of(), Map.of(), Map.of()))
        .hasMessageContaining("at least one");
  }
}
