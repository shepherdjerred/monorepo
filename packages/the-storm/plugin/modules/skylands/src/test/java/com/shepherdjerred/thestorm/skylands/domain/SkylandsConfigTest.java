package com.shepherdjerred.thestorm.skylands.domain;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.config.Problem;
import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.core.result.Result;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

final class SkylandsConfigTest {

  /** The file the server ships, relative to this module's project directory. */
  static final Path SHIPPED = Path.of("../../../server/owned/plugins/TheStorm/skylands.yml");

  private static final String VALID =
      """
      world: skylands
      seed: 1731
      verticalOffset: 64
      spawnSearchChunks: 16
      blockedStructures:
        - minecraft:monument
      biomeRemap:
        "minecraft:ocean": "minecraft:plains"
      ores:
        - block: minecraft:diamond_ore
          attempts: 4
          size: 5
          minY: 16
          maxY: 40
      """;

  static Result<SkylandsConfig, List<Problem>> parse(String yaml) {
    return StrictYaml.parse("skylands.yml", yaml, SkylandsConfig.class);
  }

  static List<Problem> problems(String yaml) {
    return parse(yaml).fold(config -> List.of(), found -> found);
  }

  @Test
  void theShippedFileParses() throws IOException {
    var config =
        parse(Files.readString(SHIPPED))
            .fold(
                parsed -> parsed,
                found -> {
                  throw new AssertionError(found);
                });

    assertThat(config.world()).isEqualTo("skylands");
    assertThat(config.verticalOffset() + SkyTerrain.HEIGHT)
        .isLessThanOrEqualTo(SkylandsConfig.MAX_Y);
    assertThat(config.blockedStructures())
        .contains("minecraft:monument", "minecraft:shipwreck", "minecraft:ocean_ruin_cold");
    assertThat(config.biomeRemap())
        .containsKeys(
            "minecraft:ocean", "minecraft:deep_ocean", "minecraft:river", "minecraft:beach");
    assertThat(IslandSpawn.find(new SkyTerrain(config.seed()), config.spawnSearchChunks()))
        .isPresent();
    assertThat(config.ores())
        .extracting(OreVein::block)
        .contains(
            "minecraft:diamond_ore",
            "minecraft:redstone_ore",
            "minecraft:lapis_ore",
            "minecraft:gold_ore");
  }

  @Test
  void aCompleteFileParses() {
    assertThat(problems(VALID)).isEmpty();
  }

  @Test
  void everyKeyIsRequired() {
    assertThat(problems(VALID.replace("spawnSearchChunks: 16\n", ""))).isNotEmpty();
    assertThat(problems(VALID.replace("seed: 1731\n", ""))).isNotEmpty();
  }

  @Test
  void unknownKeysAreRejected() {
    assertThat(problems(VALID + "lakes: true\n")).isNotEmpty();
  }

  @ParameterizedTest
  @ValueSource(ints = {-65, 193, 300})
  void theTerrainMustFitTheOverworld(int offset) {
    assertThat(problems(VALID.replace("verticalOffset: 64", "verticalOffset: " + offset)))
        .singleElement()
        .satisfies(problem -> assertThat(problem.toString()).contains("verticalOffset"));
  }

  @Test
  void theWholeOverworldRangeIsAllowed() {
    assertThat(problems(VALID.replace("verticalOffset: 64", "verticalOffset: -64"))).isEmpty();
    assertThat(problems(VALID.replace("verticalOffset: 64", "verticalOffset: 192"))).isEmpty();
  }

  @Test
  void structuresAreNamespacedAndListedOnce() {
    assertThat(problems(VALID.replace("minecraft:monument", "monument"))).isNotEmpty();
    assertThat(
            problems(
                VALID.replace(
                    "  - minecraft:monument\n",
                    "  - minecraft:monument\n  - minecraft:monument\n")))
        .isNotEmpty();
  }

  @Test
  void aRemapTargetCannotItselfBeRemapped() {
    assertThat(
            problems(
                VALID.replace(
                    "\"minecraft:ocean\": \"minecraft:plains\"",
                    "\"minecraft:ocean\": \"minecraft:river\"\n  \"minecraft:river\": \"minecraft:plains\"")))
        .isNotEmpty();
  }

  @Test
  void anOreVeinMustFitTheTerrain() {
    assertThat(problems(VALID.replace("maxY: 40", "maxY: 128"))).isNotEmpty();
    assertThat(problems(VALID.replace("attempts: 4", "attempts: 0"))).isNotEmpty();
  }

  @Test
  void theWorldNameIsAKeyPath() {
    assertThat(problems(VALID.replace("world: skylands", "world: Sky Lands"))).isNotEmpty();
  }
}
