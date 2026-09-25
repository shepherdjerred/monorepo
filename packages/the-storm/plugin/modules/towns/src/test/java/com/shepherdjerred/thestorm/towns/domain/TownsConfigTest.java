package com.shepherdjerred.thestorm.towns.domain;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlag;
import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.Subject;
import com.shepherdjerred.thestorm.towns.domain.region.RegionIndex;
import java.nio.file.Path;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

final class TownsConfigTest {

  /** The file the server actually ships, relative to this module's project directory. */
  private static final Path SHIPPED = Path.of("../../../server/owned/plugins/TheStorm/towns.yml");

  private static final String VALID =
      """
      claims:
        worlds: [world]
        buffer: 2
        maxClaimsPerTown: 64
        defaultFlags: [PUBLIC_SWITCHES]
      denialCooldownMillis: 2000
      grief:
        witherBufferChunks: 8
        raidRadiusBlocks: 64
        thrownItemMemoryTicks: 100
      regions:
        - id: spawn
          name: Spawn
          areas:
            chunks:
              - world: world
                from: {x: -4, z: -4}
                to: {x: 3, z: 3}
            cuboids: []
          allow:
            - action: INTERACT
              subjects: [DOOR]
      """;

  private static boolean parses(String yaml) {
    return StrictYaml.parse("towns.yml", yaml, TownsConfig.class).isOk();
  }

  @Test
  void theShippedFileParsesWithSpawnAndArena() {
    var config = ConfigFiles.load(SHIPPED, TownsConfig.class);
    var regions = new RegionIndex(config.regions());

    assertThat(config.regions())
        .extracting(region -> region.id())
        .containsExactly("spawn", "arena");
    assertThat(config.claims().defaultFlags()).containsExactly(ClaimFlag.PVP);
    var spawn = regions.byId("spawn").orElseThrow();
    assertThat(spawn.permits(new Act(Action.INTERACT, Subject.DOOR))).isTrue();
    assertThat(spawn.permits(new Act(Action.OPEN_CONTAINER, Subject.CONTAINER))).isFalse();
    assertThat(spawn.permits(new Act(Action.TELEPORT_INTO, Subject.LOCATION))).isTrue();
    assertThat(spawn.permits(new Act(Action.SET_HOME, Subject.LOCATION))).isFalse();
    assertThat(spawn.permits(new Act(Action.ATTACK_PLAYER, Subject.PLAYER))).isFalse();
    assertThat(spawn.permits(new Act(Action.BUILD, Subject.BLOCK))).isFalse();
  }

  @Test
  void aValidDocumentParses() {
    var config = StrictYaml.parse("towns.yml", VALID, TownsConfig.class);

    assertThat(config.isOk()).isTrue();
    Set<ClaimFlag> flags = config.fold(c -> c.claims().defaultFlags(), problems -> Set.of());
    assertThat(flags).containsExactly(ClaimFlag.PUBLIC_SWITCHES);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "denialCooldownMillis: 2000\n",
        "  thrownItemMemoryTicks: 100\n",
        "  buffer: 2\n",
        "        subjects: [DOOR]\n",
        "      cuboids: []\n",
      })
  void missingKeysAreRejected(String line) {
    assertThat(parses(VALID.replace(line, ""))).isFalse();
  }

  @Test
  void theRaidRadiusRoundsUpToWholeChunks() {
    assertThat(new GriefLimits(8, 64, 100).raidRadiusChunks()).isEqualTo(4);
    assertThat(new GriefLimits(8, 65, 100).raidRadiusChunks()).isEqualTo(5);
    assertThat(new GriefLimits(8, 0, 100).raidRadiusChunks()).isZero();
  }

  @Test
  void unknownKeysAreRejected() {
    assertThat(parses(VALID + "wilderness: true\n")).isFalse();
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "defaultFlags: [PUBLIC_SWITCHES]|defaultFlags: [FLYING]",
        "subjects: [DOOR]|subjects: [DOOR, ANY]",
        "subjects: [DOOR]|subjects: [CHAIR]",
        "action: INTERACT|action: FLY",
        "buffer: 2|buffer: -1",
        "buffer: 2|buffer: 17",
        "maxClaimsPerTown: 64|maxClaimsPerTown: 0",
        "worlds: [world]|worlds: []",
        "raidRadiusBlocks: 64|raidRadiusBlocks: 300",
        "thrownItemMemoryTicks: 100|thrownItemMemoryTicks: -1",
        "witherBufferChunks: 8|witherBufferChunks: 17",
        "denialCooldownMillis: 2000|denialCooldownMillis: -5",
        "from: {x: -4, z: -4}|from: {x: 5, z: -4}",
        "id: spawn|id: Spawn Town",
        "to: {x: 3, z: 3}|to: {x: 300, z: 300}",
      })
  void invalidValuesAreRejected(String replacement) {
    var parts = replacement.split("\\|", -1);
    assertThat(parses(VALID.replace(parts[0], parts[1]))).isFalse();
  }

  @Test
  void regionIdsMustBeUnique() {
    var twice =
        VALID
            + """
              - id: spawn
                name: Again
                areas:
                  chunks: []
                  cuboids:
                    - world: world
                      from: {x: 0, y: 0, z: 0}
                      to: {x: 1, y: 1, z: 1}
                allow: []
            """;
    assertThat(parses(twice)).isFalse();
  }
}
