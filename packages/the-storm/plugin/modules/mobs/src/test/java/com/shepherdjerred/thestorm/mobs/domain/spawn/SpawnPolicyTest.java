package com.shepherdjerred.thestorm.mobs.domain.spawn;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.mobs.domain.spawn.SpawnVerdict.Reason;
import java.util.EnumSet;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.EnumSource;

final class SpawnPolicyTest {

  static final Exclusions EXCLUSIONS =
      new Exclusions(Set.of("warden", "phantom"), Set.of("SPAWNER", "CUSTOM"), true);

  static SpawnPolicy policy(AdminPolicy admin) {
    return new SpawnPolicy(EXCLUSIONS, admin);
  }

  static SpawnFacts mob(String type, String reason, Trait... traits) {
    var set = EnumSet.noneOf(Trait.class);
    set.addAll(java.util.List.of(traits));
    return new SpawnFacts(type, reason, set);
  }

  static SpawnVerdict leave(Reason reason) {
    return new SpawnVerdict.Leave(reason);
  }

  static final SpawnVerdict LEVEL = new SpawnVerdict.Level();

  @Test
  void aNaturalHostileMobIsLevelled() {
    assertThat(policy(AdminPolicy.BLOCK_NATURAL).decide(mob("zombie", "NATURAL", Trait.HOSTILE)))
        .isEqualTo(LEVEL);
  }

  @Test
  void passiveMobsAreNeverLevelled() {
    assertThat(policy(AdminPolicy.LEVELLED).decide(mob("cow", "NATURAL")))
        .isEqualTo(leave(Reason.NOT_HOSTILE));
  }

  @Test
  void arenaMobsAreLeftAloneBeforeAnythingElse() {
    var arena = mob("zombie", "NATURAL", Trait.HOSTILE, Trait.ARENA, Trait.ADMIN_REGION);
    assertThat(policy(AdminPolicy.BLOCK_NATURAL).decide(arena)).isEqualTo(leave(Reason.ARENA));
  }

  @ParameterizedTest
  @CsvSource({
    "BOSS, BOSS",
    "NAMED, NAMED",
    "TAMED, TAMED",
    "BABY, BABY",
  })
  void excludedKindsOfHostileMobStayVanilla(Trait trait, Reason reason) {
    assertThat(policy(AdminPolicy.LEVELLED).decide(mob("zombie", "NATURAL", Trait.HOSTILE, trait)))
        .isEqualTo(leave(reason));
  }

  @Test
  void babiesAreLevelledWhenNotExcluded() {
    var babies = new SpawnPolicy(new Exclusions(Set.of(), Set.of(), false), AdminPolicy.LEVELLED);
    assertThat(babies.decide(mob("zombie", "NATURAL", Trait.HOSTILE, Trait.BABY))).isEqualTo(LEVEL);
  }

  @Test
  void excludedTypesAndReasonsStayVanilla() {
    var policy = policy(AdminPolicy.LEVELLED);
    assertThat(policy.decide(mob("warden", "NATURAL", Trait.HOSTILE)))
        .isEqualTo(leave(Reason.EXCLUDED_TYPE));
    assertThat(policy.decide(mob("zombie", "SPAWNER", Trait.HOSTILE)))
        .isEqualTo(leave(Reason.EXCLUDED_REASON));
    assertThat(policy.decide(mob("zombie", "CUSTOM", Trait.HOSTILE)))
        .isEqualTo(leave(Reason.EXCLUDED_REASON));
    assertThat(policy.decide(mob("zombie", "SLIME_SPLIT", Trait.HOSTILE))).isEqualTo(LEVEL);
  }

  @ParameterizedTest
  @CsvSource({"NATURAL", "JOCKEY", "MOUNT", "PATROL", "REINFORCEMENTS"})
  void blockNaturalStopsNaturalSpawnsInAdminRegions(String reason) {
    assertThat(
            policy(AdminPolicy.BLOCK_NATURAL)
                .decide(mob("zombie", reason, Trait.HOSTILE, Trait.ADMIN_REGION)))
        .isEqualTo(new SpawnVerdict.Block());
  }

  @ParameterizedTest
  @CsvSource({"SPAWNER", "SPAWNER_EGG", "COMMAND", "SLIME_SPLIT"})
  void blockNaturalLeavesOtherSpawnsInAdminRegionsUnlevelled(String reason) {
    assertThat(
            policy(AdminPolicy.BLOCK_NATURAL)
                .decide(mob("zombie", reason, Trait.HOSTILE, Trait.ADMIN_REGION)))
        .isEqualTo(leave(Reason.ADMIN_REGION));
  }

  @Test
  void passiveMobsInAdminRegionsAreNeverBlocked() {
    assertThat(policy(AdminPolicy.BLOCK_NATURAL).decide(mob("cow", "NATURAL", Trait.ADMIN_REGION)))
        .isEqualTo(leave(Reason.NOT_HOSTILE));
  }

  @Test
  void unlevelledAdminRegionsLetEverythingSpawnWithoutALevel() {
    assertThat(
            policy(AdminPolicy.UNLEVELLED)
                .decide(mob("zombie", "NATURAL", Trait.HOSTILE, Trait.ADMIN_REGION)))
        .isEqualTo(leave(Reason.ADMIN_REGION));
  }

  @Test
  void levelledAdminRegionsAreLikeAnywhereElse() {
    var policy = policy(AdminPolicy.LEVELLED);
    assertThat(policy.decide(mob("zombie", "NATURAL", Trait.HOSTILE, Trait.ADMIN_REGION)))
        .isEqualTo(LEVEL);
    assertThat(policy.decide(mob("zombie", "SPAWNER", Trait.HOSTILE, Trait.ADMIN_REGION)))
        .isEqualTo(leave(Reason.EXCLUDED_REASON));
  }

  @ParameterizedTest
  @EnumSource(AdminPolicy.class)
  void outsideAdminRegionsThePolicyDoesNotMatter(AdminPolicy admin) {
    assertThat(policy(admin).decide(mob("zombie", "NATURAL", Trait.HOSTILE))).isEqualTo(LEVEL);
  }

  @Test
  void exclusionsNeedCanonicalNames() {
    assertThatThrownBy(() -> new Exclusions(Set.of("Zombie"), Set.of(), true))
        .hasMessageContaining("lowercase");
    assertThatThrownBy(() -> new Exclusions(Set.of(), Set.of("spawner"), true))
        .hasMessageContaining("uppercase");
    assertThatThrownBy(() -> new Exclusions(Set.of(" "), Set.of(), true))
        .hasMessageContaining("lowercase");
  }
}
