package com.shepherdjerred.thestorm.shards.domain;

import static com.shepherdjerred.thestorm.shards.domain.Fixtures.tier;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.shards.domain.UpgradeOutcome.Failed;
import com.shepherdjerred.thestorm.shards.domain.UpgradeOutcome.Shattered;
import com.shepherdjerred.thestorm.shards.domain.UpgradeOutcome.Upgraded;
import com.shepherdjerred.thestorm.shards.domain.UpgradeRefusal.AtMaxTier;
import com.shepherdjerred.thestorm.shards.domain.UpgradeRefusal.NoStorm;
import com.shepherdjerred.thestorm.shards.domain.UpgradeRefusal.NotEnoughShards;
import com.shepherdjerred.thestorm.shards.domain.UpgradeRefusal.NotUpgradeable;
import java.util.List;
import java.util.Optional;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

final class UpgradesTest {

  private final Upgrades upgrades = new Upgrades(Fixtures.upgrades());

  private static UpgradeRequest sword(Optional<StormTier> current, int shards) {
    return new UpgradeRequest(Optional.of(GearCategory.SWORD), current, shards, true);
  }

  @Test
  void aFreshItemBecomesStormOne() {
    var random = ScriptedRandom.rolls(0.99);

    assertThat(upgrades.attempt(sword(Optional.empty(), 1), random))
        .isEqualTo(Result.ok(new Upgraded(tier(1), 1)));
  }

  @ParameterizedTest
  @CsvSource({"1,2,2", "2,3,4", "3,4,6", "4,5,10"})
  void eachTierCostsItsConfiguredShards(int from, int to, int cost) {
    var result = upgrades.attempt(sword(Optional.of(tier(from)), cost), ScriptedRandom.rolls(0.99));

    assertThat(result).isEqualTo(Result.ok(new Upgraded(tier(to), cost)));
  }

  @Test
  void rollsBelowTheBreakChanceShatter() {
    // Storm IV: break 0.05, fail 0.2.
    var result = upgrades.attempt(sword(Optional.of(tier(3)), 6), ScriptedRandom.rolls(0.049));

    assertThat(result).isEqualTo(Result.ok(new Shattered(tier(4), 6)));
  }

  @Test
  void rollsBetweenBreakAndBreakPlusFailFail() {
    var atBreak = upgrades.attempt(sword(Optional.of(tier(3)), 6), ScriptedRandom.rolls(0.05));
    var belowSum = upgrades.attempt(sword(Optional.of(tier(3)), 6), ScriptedRandom.rolls(0.249));

    assertThat(atBreak).isEqualTo(Result.ok(new Failed(tier(4), 6)));
    assertThat(belowSum).isEqualTo(Result.ok(new Failed(tier(4), 6)));
  }

  @Test
  void rollsAtOrAboveBreakPlusFailSucceed() {
    var result = upgrades.attempt(sword(Optional.of(tier(3)), 6), ScriptedRandom.rolls(0.25));

    assertThat(result).isEqualTo(Result.ok(new Upgraded(tier(4), 6)));
  }

  @Test
  void aZeroRiskTierAlwaysSucceeds() {
    var result = upgrades.attempt(sword(Optional.empty(), 1), ScriptedRandom.rolls(0.0));

    assertThat(result).isEqualTo(Result.ok(new Upgraded(tier(1), 1)));
  }

  @Test
  void stormVIsTheCap() {
    var result = upgrades.attempt(sword(Optional.of(tier(5)), 100), ScriptedRandom.rolls());

    assertThat(result).isEqualTo(Result.err(new AtMaxTier()));
  }

  @Test
  void anItemOutsideEveryCategoryIsRefused() {
    var request = new UpgradeRequest(Optional.empty(), Optional.empty(), 100, true);

    assertThat(upgrades.attempt(request, ScriptedRandom.rolls()))
        .isEqualTo(Result.err(new NotUpgradeable()));
  }

  @Test
  void clearSkiesAreRefused() {
    var request = new UpgradeRequest(Optional.of(GearCategory.BOOTS), Optional.empty(), 100, false);

    assertThat(upgrades.attempt(request, ScriptedRandom.rolls()))
        .isEqualTo(Result.err(new NoStorm()));
  }

  @Test
  void tooFewShardsAreRefusedWithTheShortfall() {
    var result = upgrades.attempt(sword(Optional.of(tier(4)), 9), ScriptedRandom.rolls());

    assertThat(result).isEqualTo(Result.err(new NotEnoughShards(tier(5), 10, 9)));
  }

  @Test
  void refusalsComeInTheOrderAPlayerFixesThem() {
    var nothingRight = new UpgradeRequest(Optional.empty(), Optional.of(tier(5)), 0, false);
    var maxedInClearSkies =
        new UpgradeRequest(Optional.of(GearCategory.AXE), Optional.of(tier(5)), 0, false);
    var brokeInClearSkies =
        new UpgradeRequest(Optional.of(GearCategory.AXE), Optional.empty(), 0, false);

    assertThat(upgrades.attempt(nothingRight, ScriptedRandom.rolls()))
        .isEqualTo(Result.err(new NotUpgradeable()));
    assertThat(upgrades.attempt(maxedInClearSkies, ScriptedRandom.rolls()))
        .isEqualTo(Result.err(new AtMaxTier()));
    assertThat(upgrades.attempt(brokeInClearSkies, ScriptedRandom.rolls()))
        .isEqualTo(Result.err(new NoStorm()));
  }

  @Test
  void aSeededRandomMatchesTheConfiguredOdds() {
    var random = new SplittableRandom(71L);
    int upgraded = 0;
    int failed = 0;
    int shattered = 0;
    var total = 100_000;
    for (var i = 0; i < total; i++) {
      switch (upgrades.attempt(sword(Optional.of(tier(4)), 10), random)) {
        case Result.Ok<UpgradeOutcome, UpgradeRefusal>(Upgraded _) -> upgraded++;
        case Result.Ok<UpgradeOutcome, UpgradeRefusal>(Failed _) -> failed++;
        case Result.Ok<UpgradeOutcome, UpgradeRefusal>(Shattered _) -> shattered++;
        case Result.Err<UpgradeOutcome, UpgradeRefusal> err -> throw new AssertionError(err);
      }
    }
    // Storm V: break 0.1, fail 0.3, success 0.6.
    assertThat(shattered / (double) total).isBetween(0.095, 0.105);
    assertThat(failed / (double) total).isBetween(0.295, 0.305);
    assertThat(upgraded / (double) total).isBetween(0.595, 0.605);
  }

  @Test
  void broadcastsStartAtTheConfiguredTier() {
    assertThat(upgrades.broadcasts(tier(2))).isFalse();
    assertThat(upgrades.broadcasts(tier(3))).isTrue();
    assertThat(upgrades.broadcasts(tier(5))).isTrue();
  }

  @Test
  void lightningStrikesOncePerTier() {
    assertThat(Upgrades.lightningStrikes(tier(1))).isEqualTo(1);
    assertThat(Upgrades.lightningStrikes(tier(5))).isEqualTo(5);
  }

  @Test
  void costsComeFromTheTierRules() {
    assertThat(upgrades.cost(tier(1))).isEqualTo(1);
    assertThat(upgrades.cost(tier(5))).isEqualTo(10);
  }

  @Test
  void tierRulesValidateThemselves() {
    assertThatThrownBy(() -> new TierRule(0, 0, 0)).hasMessageContaining("cost");
    assertThatThrownBy(() -> new TierRule(1, -0.1, 0)).hasMessageContaining("failChance");
    assertThatThrownBy(() -> new TierRule(1, 0, 1.1)).hasMessageContaining("breakChance");
    assertThatThrownBy(() -> new TierRule(1, 0.6, 0.5)).hasMessageContaining("at most 1");
    assertThat(new TierRule(1, 0.3, 0.1).successChance()).isCloseTo(0.6, within(1e-9));
  }

  @Test
  void upgradeConfigValidatesItself() {
    var rules = Fixtures.upgrades().tiers();
    assertThatThrownBy(() -> new UpgradeConfig(rules.subList(0, 4), 3, "Storm <tier>", 1000))
        .hasMessageContaining("one entry per tier");
    assertThatThrownBy(() -> new UpgradeConfig(rules, 0, "Storm <tier>", 1000))
        .hasMessageContaining("broadcastFromTier");
    assertThatThrownBy(() -> new UpgradeConfig(rules, 7, "Storm <tier>", 1000))
        .hasMessageContaining("broadcastFromTier");
    assertThatThrownBy(() -> new UpgradeConfig(rules, 3, "Storm", 1000))
        .hasMessageContaining("<tier>");
    assertThatThrownBy(() -> new UpgradeConfig(rules, 3, "Storm <tier>", 200))
        .hasMessageContaining("attemptCooldownMillis");
    assertThat(new UpgradeConfig(rules, 3, "Storm <tier>", 1500).attemptCooldown())
        .isEqualTo(java.time.Duration.ofMillis(1500));
    assertThat(new UpgradeConfig(List.copyOf(rules), 6, "Storm <tier>", 1000).broadcastFromTier())
        .isEqualTo(6);
  }

  @Test
  void requestsRejectNegativeShards() {
    assertThatThrownBy(() -> sword(Optional.empty(), -1)).hasMessageContaining("shardsHeld");
  }
}
