package com.shepherdjerred.thestorm.rwf.adapter.content;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import org.bukkit.Bukkit;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;

/** The config and content the server ships load, agree with the code, and keep the design. */
final class ShippedContentTest {

  /** {@code plugins/TheStorm} as the repository owns it, relative to this module. */
  static final Path SHIPPED = Path.of("../../../server/owned/plugins/TheStorm");

  private static RwfContent content;

  @BeforeAll
  static void load() {
    MockBukkit.mock();
    content = ContentFiles.load(SHIPPED, Bukkit::createBlockData);
  }

  @AfterAll
  static void unmock() {
    MockBukkit.unmock();
  }

  @Test
  void theWorldIsSealedAndMatchesStartWithOneHuman() {
    assertThat(content.config().world()).isEqualTo("rwf");
    assertThat(content.config().match().minHumans()).isEqualTo(1);
    assertThat(content.config().match().countdown()).isEqualTo(Duration.ofSeconds(90));
    assertThat(content.config().match().maxCombatants()).isEqualTo(100);
    assertThat(content.config().matchSettings().maxPlayers()).isEqualTo(100);
  }

  @Test
  void recordingIsOnWithASaltFromTheEnvironmentAndTheLoadTestIsOff() {
    assertThat(content.config().recording().enabled()).isTrue();
    assertThat(content.config().recording().saltEnv()).isEqualTo("RWF_RECORDING_SALT");
    assertThat(content.config().loadtest().enabled()).isFalse();
  }

  @Test
  void theKitsFileMirrorsTheKitBook() {
    assertThat(content.kits()).isEqualTo(KitBook.MILESTONE_ONE);
  }

  @Test
  void theTrainingYardIsATwoTeamMapWithANuke() {
    assertThat(content.maps()).hasSize(1);
    var map = content.maps().getFirst();
    assertThat(map.id()).isEqualTo("training-yard");
    assertThat(map.definition().teamColors()).containsExactly(TeamColor.RED, TeamColor.BLUE);
    assertThat(map.definition().hasNuke()).isTrue();
    assertThat(map.definition().bombs()).hasSize(3);
    assertThat(map.blocks().schematic().size()).isEqualTo(new Schematic.Dimensions(64, 16, 64));
  }

  @Test
  void theShippedSchematicIsExactlyWhatTheGeneratorProduces() {
    var generated = TrainingYard.generate();
    var shipped = content.maps().getFirst().blocks().schematic();

    assertThat(shipped.sha256()).isEqualTo(generated.sha256());
    assertThat(shipped.palette()).isEqualTo(generated.palette());
    assertThat(read(SHIPPED.resolve("rwf/maps/training-yard/blocks.schem")))
        .isEqualTo(SchematicWriter.write(generated));
  }

  @Test
  void theLobbyStandsOnTheGlassPlatform() {
    var map = content.maps().getFirst();
    var lobby = content.config().lobby();
    var below = map.blocks().at(map.definition().lobbyPoint().position().toBlock().plus(0, -1, 0));

    assertThat(below.getAsString()).isEqualTo("minecraft:glass");
    assertThat(lobby.toSpawn()).isEqualTo(map.definition().lobbyPoint());
  }

  private static byte[] read(Path file) {
    try {
      return Files.readAllBytes(file);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }
}
