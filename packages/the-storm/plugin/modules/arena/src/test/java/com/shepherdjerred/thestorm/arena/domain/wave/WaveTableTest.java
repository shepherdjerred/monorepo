package com.shepherdjerred.thestorm.arena.domain.wave;

import static com.shepherdjerred.thestorm.arena.testing.Samples.FLAT;
import static com.shepherdjerred.thestorm.arena.testing.Samples.NO_SCALING;
import static com.shepherdjerred.thestorm.arena.testing.Samples.boss;
import static com.shepherdjerred.thestorm.arena.testing.Samples.bossWave;
import static com.shepherdjerred.thestorm.arena.testing.Samples.mob;
import static com.shepherdjerred.thestorm.arena.testing.Samples.mounted;
import static com.shepherdjerred.thestorm.arena.testing.Samples.spawn;
import static com.shepherdjerred.thestorm.arena.testing.Samples.wave;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.arena.testing.Samples;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class WaveTableTest {

  private static final Map<String, MobArchetype> MOBS = Map.of("zombie", mob("ZOMBIE"));

  private static List<String> problems(WaveFile file) {
    return WaveTable.of(file).fold(table -> List.of(), problems -> problems);
  }

  @Test
  void everyWaveMustBeCoveredExactlyOnce() {
    var file =
        new WaveFile(
            5,
            MOBS,
            Map.of(),
            List.of(
                wave(1, 2, WaveKind.STANDARD, spawn("zombie", 1)),
                wave(2, 3, WaveKind.STANDARD, spawn("zombie", 1)),
                wave(6, 6, WaveKind.STANDARD, spawn("zombie", 1))));

    assertThat(problems(file))
        .containsExactlyInAnyOrder(
            "wave 2 is covered by 2 entries",
            "wave 4 is not covered by any entry",
            "wave 5 is not covered by any entry",
            "entry 6-6 runs past finalWave 5");
  }

  @Test
  void everyReferenceMustExist() {
    var file =
        new WaveFile(
            2,
            Map.of("zombie", mob("ZOMBIE"), "horse", mounted("ZOMBIE_HORSE", "ghost")),
            Map.of(
                "king",
                new BossDefinition(
                    "dragon",
                    "King",
                    10,
                    BarColor.RED,
                    List.of(
                        new AbilitySpec(
                            AbilityType.SUMMON_ADDS,
                            Duration.ofSeconds(5),
                            0,
                            0,
                            1,
                            Optional.of("imp"))))),
            List.of(wave(1, 1, WaveKind.STANDARD, spawn("skeleton", 1)), bossWave(2, "queen")));

    assertThat(problems(file))
        .containsExactlyInAnyOrder(
            "mob horse has unknown rider ghost",
            "boss king uses unknown mob dragon",
            "boss king summons unknown mob imp",
            "entry 1-1 spawns unknown mob skeleton",
            "entry 2-2 names unknown boss queen");
  }

  @Test
  void ridersCannotLoop() {
    var file =
        new WaveFile(
            1,
            Map.of("a", mounted("ZOMBIE", "b"), "b", mounted("ZOMBIE", "a")),
            Map.of(),
            List.of(wave(1, 1, WaveKind.STANDARD, spawn("a", 1))));

    assertThat(problems(file))
        .contains("mob a has riders nested too deep or in a loop (at a)")
        .contains("mob b has riders nested too deep or in a loop (at b)");
  }

  @Test
  void cavalryWavesNeedAMountedMob() {
    var file =
        new WaveFile(1, MOBS, Map.of(), List.of(wave(1, 1, WaveKind.CAVALRY, spawn("zombie", 1))));

    assertThat(problems(file))
        .containsExactly("entry 1-1 is a cavalry wave but none of its mobs has a rider");
  }

  @Test
  void resolvingScalesCountsAndCountsRiders() {
    var table = Samples.table();
    var file =
        new WaveFile(
            2,
            Map.of("zombie", mob("ZOMBIE"), "horse", mounted("ZOMBIE_HORSE", "zombie")),
            Map.of("king", boss("horse")),
            List.of(
                new WaveEntry(
                    1,
                    1,
                    WaveKind.CAVALRY,
                    List.of(new SpawnGroup("horse", 2, 0)),
                    Optional.empty()),
                bossWave(2, "king")));
    var cavalry = WaveTable.of(file).fold(t -> t, p -> table);

    var one = cavalry.resolve(1, new Difficulty(1, FLAT, NO_SCALING));
    assertThat(one.units()).hasSize(2).allSatisfy(unit -> assertThat(unit.entities()).isEqualTo(2));
    assertThat(one.boss()).isEmpty();

    var two = cavalry.resolve(2, new Difficulty(1, FLAT, NO_SCALING));
    assertThat(two.units()).isEmpty();
    assertThat(two.boss())
        .hasValueSatisfying(
            boss -> {
              assertThat(boss.id()).isEqualTo("king");
              assertThat(boss.entities()).isEqualTo(2);
              assertThat(boss.maxHealth()).isEqualTo(100);
            });
  }

  @Test
  void growthAddsMobsDeeperIntoTheRange() {
    var file =
        new WaveFile(
            3,
            MOBS,
            Map.of(),
            List.of(
                new WaveEntry(
                    1,
                    3,
                    WaveKind.STANDARD,
                    List.of(new SpawnGroup("zombie", 2, 1.5)),
                    Optional.empty())));
    var table = WaveTable.of(file).fold(t -> t, p -> Samples.table());
    var difficulty = new Difficulty(1, FLAT, NO_SCALING);

    assertThat(table.resolve(1, difficulty).units()).hasSize(2);
    assertThat(table.resolve(2, difficulty).units()).hasSize(4);
    assertThat(table.resolve(3, difficulty).units()).hasSize(5);
  }

  @Test
  void entriesAndKindsAreLookedUpByWave() {
    var table = Samples.table();

    assertThat(table.finalWave()).isEqualTo(4);
    assertThat(table.kind(1)).isEqualTo(WaveKind.STANDARD);
    assertThat(table.kind(2)).isEqualTo(WaveKind.BOSS);
    assertThat(table.kind(3)).isEqualTo(WaveKind.UPGRADE);
    assertThat(table.entities("horse")).isEqualTo(2);
    assertThatThrownBy(() -> table.entry(0)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> table.entry(5)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> table.mob("dragon")).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void entriesCheckTheirOwnShape() {
    assertThatThrownBy(() -> wave(3, 2, WaveKind.STANDARD, spawn("zombie", 1)))
        .hasMessageContaining("from <= to");
    assertThatThrownBy(() -> wave(1, 1, WaveKind.BOSS))
        .hasMessageContaining("boss waves name a boss");
    assertThatThrownBy(() -> new WaveEntry(1, 1, WaveKind.STANDARD, List.of(), Optional.of("king")))
        .hasMessageContaining("boss waves name a boss");
    assertThatThrownBy(() -> wave(1, 1, WaveKind.SWARM)).hasMessageContaining("at least one spawn");
    assertThat(wave(1, 1, WaveKind.UPGRADE).spawns()).isEmpty();
  }

  @Test
  void idsAreKebabCase() {
    assertThatThrownBy(
            () -> new WaveFile(1, Map.of("Big_Zombie", mob("ZOMBIE")), Map.of(), List.of()))
        .hasMessageContaining("kebab-case");
    assertThatThrownBy(() -> new WaveFile(0, MOBS, Map.of(), List.of()))
        .hasMessageContaining("finalWave");
  }
}
