package com.shepherdjerred.thestorm.arena.testing;

import com.shepherdjerred.thestorm.arena.domain.config.WaveTiming;
import com.shepherdjerred.thestorm.arena.domain.game.Setup;
import com.shepherdjerred.thestorm.arena.domain.kit.ItemSpec;
import com.shepherdjerred.thestorm.arena.domain.reward.LootEntry;
import com.shepherdjerred.thestorm.arena.domain.reward.LootTable;
import com.shepherdjerred.thestorm.arena.domain.reward.RewardSettings;
import com.shepherdjerred.thestorm.arena.domain.reward.VaultMilestone;
import com.shepherdjerred.thestorm.arena.domain.reward.VaultSettings;
import com.shepherdjerred.thestorm.arena.domain.wave.AbilitySpec;
import com.shepherdjerred.thestorm.arena.domain.wave.AbilityType;
import com.shepherdjerred.thestorm.arena.domain.wave.BarColor;
import com.shepherdjerred.thestorm.arena.domain.wave.Behavior;
import com.shepherdjerred.thestorm.arena.domain.wave.BossDefinition;
import com.shepherdjerred.thestorm.arena.domain.wave.MobArchetype;
import com.shepherdjerred.thestorm.arena.domain.wave.Scaling;
import com.shepherdjerred.thestorm.arena.domain.wave.SpawnGroup;
import com.shepherdjerred.thestorm.arena.domain.wave.Tier;
import com.shepherdjerred.thestorm.arena.domain.wave.WaveEntry;
import com.shepherdjerred.thestorm.arena.domain.wave.WaveFile;
import com.shepherdjerred.thestorm.arena.domain.wave.WaveKind;
import com.shepherdjerred.thestorm.arena.domain.wave.WaveTable;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** Small, valid domain values for tests. */
public final class Samples {

  public static final Instant T0 = Instant.parse("2026-09-25T12:00:00Z");
  public static final UUID ALICE = UUID.fromString("00000000-0000-0000-0000-00000000000a");
  public static final UUID BOB = UUID.fromString("00000000-0000-0000-0000-00000000000b");
  public static final UUID CAROL = UUID.fromString("00000000-0000-0000-0000-00000000000c");
  public static final UUID DAVE = UUID.fromString("00000000-0000-0000-0000-00000000000d");

  public static final Tier FLAT = new Tier("Ominous I", 1, 1, 1, 1);
  public static final Scaling NO_SCALING = new Scaling(0, 0, 0, 0, 0);

  private Samples() {}

  public static MobArchetype mob(String type) {
    return new MobArchetype(
        type, 1, 1, 1, 1, Optional.empty(), Map.of(), Optional.empty(), Behavior.VANILLA, 0);
  }

  public static MobArchetype mounted(String type, String rider) {
    return new MobArchetype(
        type, 1, 1, 1, 1, Optional.empty(), Map.of(), Optional.of(rider), Behavior.VANILLA, 0);
  }

  public static ItemSpec item(String material) {
    return new ItemSpec(
        material, 1, Optional.empty(), Map.of(), Optional.empty(), Optional.empty());
  }

  public static AbilitySpec slam() {
    return new AbilitySpec(
        AbilityType.KNOCKBACK_SLAM, Duration.ofSeconds(10), 4, 1, 0, Optional.empty());
  }

  public static BossDefinition boss(String mob) {
    return new BossDefinition(mob, "The King", 100, BarColor.RED, List.of(slam()));
  }

  public static WaveEntry wave(int from, int to, WaveKind kind, SpawnGroup... spawns) {
    return new WaveEntry(from, to, kind, List.of(spawns), Optional.empty());
  }

  public static WaveEntry bossWave(int number, String boss, SpawnGroup... spawns) {
    return new WaveEntry(number, number, WaveKind.BOSS, List.of(spawns), Optional.of(boss));
  }

  public static SpawnGroup spawn(String mob, int count) {
    return new SpawnGroup(mob, count, 0);
  }

  /**
   * Four waves: 1 two zombies, 2 the King (boss), 3 an upgrade with nothing, 4 the King again (the
   * final wave).
   */
  public static WaveTable table() {
    return table(2);
  }

  /** {@link #table()} with {@code zombies} zombies on wave 1. */
  public static WaveTable table(int zombies) {
    var file =
        new WaveFile(
            4,
            Map.of("zombie", mob("ZOMBIE"), "horse", mounted("ZOMBIE_HORSE", "zombie")),
            Map.of("king", boss("zombie")),
            List.of(
                wave(1, 1, WaveKind.STANDARD, spawn("zombie", zombies)),
                bossWave(2, "king"),
                wave(3, 3, WaveKind.UPGRADE),
                bossWave(4, "king", spawn("zombie", 1))));
    return WaveTable.of(file)
        .fold(
            table -> table,
            problems -> {
              throw new AssertionError(problems);
            });
  }

  public static LootTable loot() {
    return new LootTable(1, List.of(new LootEntry(1, item("DIAMOND"))));
  }

  /** From wave 2, 100 per boss wave, capped at 150 a game; a vault at wave 2. */
  public static RewardSettings rewards() {
    return new RewardSettings(
        2, 100, 150, new VaultSettings("UTC", List.of(new VaultMilestone(2, loot()))));
  }

  public static WaveTiming timing() {
    return new WaveTiming(Duration.ofSeconds(5), Duration.ofSeconds(5), Duration.ofSeconds(60), 10);
  }

  /** An arena for one to three players with two player spawns. */
  public static Setup setup() {
    return setup(1, table());
  }

  public static Setup setup(int minPlayers, WaveTable table) {
    return new Setup(
        "test",
        "Test Arena",
        minPlayers,
        3,
        2,
        Duration.ofSeconds(10),
        timing(),
        table,
        FLAT,
        NO_SCALING,
        rewards(),
        Map.of("knight", "Knight", "archer", "Archer"));
  }
}
