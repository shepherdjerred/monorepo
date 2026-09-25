package com.shepherdjerred.thestorm.shards.domain;

import static com.shepherdjerred.thestorm.shards.domain.Fixtures.OVERWORLD;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

final class AltarTest {

  private static final AltarLocation WINDMILL =
      new AltarLocation(OVERWORLD, -71, 74, -243, "EMERALD_BLOCK");
  private static final Instant NOON = Instant.parse("2026-09-25T12:00:00Z");
  private static final UUID ALICE = new UUID(0, 1);
  private static final UUID BOB = new UUID(0, 2);

  private static Altars altars() {
    return new Altars(List.of(WINDMILL), Duration.ofSeconds(1));
  }

  @Test
  void rainInAPlainsBiomeTurnsTheWindmill() {
    // Plains: temperature 0.8, downfall 0.4.
    assertThat(new AltarSky(true, true, 0.8, 0.4).raining()).isTrue();
  }

  @Test
  void clearSkiesDoNot() {
    assertThat(new AltarSky(true, false, 0.8, 0.4).raining()).isFalse();
  }

  @Test
  void snowIsNotRain() {
    // Snowy plains, or a mountain top above the snow line.
    assertThat(new AltarSky(true, true, 0.0, 0.5).raining()).isFalse();
    assertThat(new AltarSky(true, true, 0.1499, 0.5).raining()).isFalse();
    assertThat(new AltarSky(true, true, AltarSky.SNOW_BELOW, 0.5).raining()).isTrue();
  }

  @Test
  void dryBiomesNeverRain() {
    // Desert and savanna have no precipitation, and zero downfall.
    assertThat(new AltarSky(true, true, 2.0, 0.0).raining()).isFalse();
  }

  @Test
  void theNetherAndEndNeverRainEvenWhenTheOverworldDoes() {
    assertThat(new AltarSky(false, true, 0.5, 0.5).raining()).isFalse();
  }

  @Test
  void altarsMatchTheirExactBlockAndMaterial() {
    var altars = altars();

    assertThat(altars.isAltar(new BlockPos(OVERWORLD, -71, 74, -243), "EMERALD_BLOCK")).isTrue();
    assertThat(altars.isAltar(new BlockPos(OVERWORLD, -71, 75, -243), "EMERALD_BLOCK")).isFalse();
    assertThat(altars.isAltar(new BlockPos(OVERWORLD, -70, 74, -243), "EMERALD_BLOCK")).isFalse();
    assertThat(altars.isAltar(new BlockPos(OVERWORLD, -71, 74, -242), "EMERALD_BLOCK")).isFalse();
    assertThat(altars.isAltar(new BlockPos("minecraft:the_nether", -71, 74, -243), "EMERALD_BLOCK"))
        .isFalse();
    // Mined out and replaced: no longer the altar.
    assertThat(altars.isAltar(new BlockPos(OVERWORLD, -71, 74, -243), "DIRT")).isFalse();
    assertThat(WINDMILL.position()).isEqualTo(new BlockPos(OVERWORLD, -71, 74, -243));
  }

  @Test
  void theFirstAttemptIsAllowed() {
    assertThat(altars().tryAttempt(ALICE, NOON)).isTrue();
  }

  @Test
  void aSecondAttemptInTheSameTickIsRefused() {
    var altars = altars();

    assertThat(altars.tryAttempt(ALICE, NOON)).isTrue();
    assertThat(altars.tryAttempt(ALICE, NOON)).isFalse();
  }

  @Test
  void heldRightClickRepeatsAreRefusedUntilTheWindPasses() {
    var altars = altars();
    altars.tryAttempt(ALICE, NOON);

    // Held right-click repeats every four ticks (200 ms).
    for (var repeat = 1; repeat <= 4; repeat++) {
      assertThat(altars.tryAttempt(ALICE, NOON.plusMillis(200L * repeat))).isFalse();
    }
    assertThat(altars.tryAttempt(ALICE, NOON.plusMillis(999))).isFalse();
    assertThat(altars.tryAttempt(ALICE, NOON.plusMillis(1000))).isTrue();
  }

  @Test
  void refusedAttemptsDoNotExtendTheWindow() {
    var altars = altars();
    altars.tryAttempt(ALICE, NOON);
    altars.tryAttempt(ALICE, NOON.plusMillis(900));

    assertThat(altars.tryAttempt(ALICE, NOON.plusMillis(1000))).isTrue();
  }

  @Test
  void eachPlayerHasTheirOwnCooldown() {
    var altars = altars();
    altars.tryAttempt(ALICE, NOON);

    assertThat(altars.tryAttempt(BOB, NOON)).isTrue();
    assertThat(altars.tryAttempt(BOB, NOON.plusMillis(10))).isFalse();
  }

  @Test
  void theCooldownMustBePositive() {
    assertThatThrownBy(() -> new Altars(List.of(WINDMILL), Duration.ZERO))
        .hasMessageContaining("cooldown");
  }

  @ParameterizedTest
  @CsvSource({"world", "Minecraft:Overworld", "''"})
  void altarWorldsAreNamespacedKeys(String world) {
    assertThatThrownBy(() -> new AltarLocation(world, 0, 64, 0, "EMERALD_BLOCK"))
        .hasMessageContaining("namespaced key");
  }

  @Test
  void altarMaterialsAreConstants() {
    assertThatThrownBy(() -> new AltarLocation(OVERWORLD, 0, 64, 0, "emerald_block"))
        .hasMessageContaining("altars[].material");
  }
}
