package com.shepherdjerred.thestorm.towns.domain.region;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.towns.domain.Fixtures;
import com.shepherdjerred.thestorm.towns.domain.TownsConfig;
import com.shepherdjerred.thestorm.towns.domain.land.Land;
import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.Actor;
import com.shepherdjerred.thestorm.towns.domain.protection.ProtectionEngine;
import com.shepherdjerred.thestorm.towns.domain.protection.PvpPreferences;
import com.shepherdjerred.thestorm.towns.domain.protection.Subject;
import java.nio.file.Path;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * The arena as shipped: only the arena module's waves (and what they bring) and staff summons spawn
 * inside, and players may break the creaking heart that ends the creaking fight but nothing else.
 * Spawn limits no spawns.
 */
final class ArenaRegionTest {

  private static final Path SHIPPED = Path.of("../../../server/owned/plugins/TheStorm/towns.yml");

  private final RegionIndex regions =
      new RegionIndex(ConfigFiles.load(SHIPPED, TownsConfig.class).regions());
  private final AdminRegion arena = regions.byId("arena").orElseThrow();
  private final AdminRegion spawn = regions.byId("spawn").orElseThrow();

  @ParameterizedTest
  @ValueSource(
      strings = {"CUSTOM", "COMMAND", "SPELL", "REINFORCEMENTS", "SLIME_SPLIT", "JOCKEY", "MOUNT"})
  void theArenasOwnMobsSpawn(String reason) {
    assertThat(arena.mobSpawns().allows(reason)).isTrue();
  }

  @ParameterizedTest
  @ValueSource(strings = {"NATURAL", "SPAWNER", "SPAWNER_EGG", "BREEDING", "PATROL", "RAID"})
  void nothingElseSpawnsInTheArena(String reason) {
    assertThat(arena.mobSpawns().allows(reason)).isFalse();
  }

  @Test
  void spawnLimitsNoSpawns() {
    assertThat(spawn.mobSpawns().limited()).isFalse();
    assertThat(spawn.mobSpawns().allows("NATURAL")).isTrue();
  }

  @Test
  void playersBreakTheCreakingHeartButNothingElse() {
    var engine = new ProtectionEngine(Fixtures.trust(), PvpPreferences.EVERYONE);
    var land = new Land.RegionLand(arena);
    var player = Actor.player(Fixtures.NOMAD);

    assertThat(
            engine.decide(player, new Act(Action.BREAK, Subject.CREAKING_HEART), land).isAllowed())
        .isTrue();
    for (var subject : Set.of(Subject.BLOCK, Subject.CONTAINER, Subject.DOOR, Subject.SIGN)) {
      assertThat(engine.decide(player, new Act(Action.BREAK, subject), land).isAllowed())
          .as("%s", subject)
          .isFalse();
    }
    assertThat(
            engine.decide(player, new Act(Action.BUILD, Subject.CREAKING_HEART), land).isAllowed())
        .isFalse();
    assertThat(
            engine
                .decide(
                    player,
                    new Act(Action.BREAK, Subject.CREAKING_HEART),
                    new Land.RegionLand(spawn))
                .isAllowed())
        .isFalse();
  }

  @Test
  void spawnRulesAreWellFormed() {
    assertThat(RegionSpawns.unlimited().allows("ANYTHING")).isTrue();
    assertThat(new RegionSpawns(true, Set.of()).allows("NATURAL")).isFalse();
    assertThatThrownBy(() -> new RegionSpawns(false, Set.of("CUSTOM")))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new RegionSpawns(true, Set.of("custom")))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
