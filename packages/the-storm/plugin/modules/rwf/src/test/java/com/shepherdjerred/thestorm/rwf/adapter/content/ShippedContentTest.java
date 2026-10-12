package com.shepherdjerred.thestorm.rwf.adapter.content;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import com.shepherdjerred.thestorm.rwf.domain.lobby.LobbyBuild;
import com.shepherdjerred.thestorm.rwf.domain.lobby.LobbySizing;
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

  private static RwfCatalog content;
  private static LoadedMap trainingYard;

  @BeforeAll
  static void load() {
    MockBukkit.mock();
    content = ContentFiles.catalog(SHIPPED, Bukkit::createBlockData);
    trainingYard =
        content.maps().stream()
            .filter(map -> map.id().equals("training-yard"))
            .findFirst()
            .orElseThrow(() -> new IllegalStateException("Training Yard is missing"))
            .load();
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
    assertThat(content.config().match().automaticSizing()).isTrue();
    assertThat(content.config().matchSettings().maxPlayers()).isEqualTo(100);
  }

  @Test
  void everyMapHasBalancedOrderedRecommendationsWithinItsSpawnAndServerCaps() {
    for (var source : content.maps()) {
      var map = source.definition();
      var sizes = LobbySizing.recommend(map, 100);
      var teams = map.teams().size();
      var capacity =
          map.teams().stream().mapToInt(team -> team.spawns().size()).min().orElseThrow() * teams;
      assertThat(sizes.small()).as(map.id()).isBetween(teams, sizes.medium());
      assertThat(sizes.medium()).as(map.id()).isLessThanOrEqualTo(sizes.large());
      assertThat(sizes.large()).as(map.id()).isLessThanOrEqualTo(Math.min(100, capacity));
      assertThat(sizes.small() % teams).isZero();
      assertThat(sizes.medium() % teams).isZero();
      assertThat(sizes.large() % teams).isZero();
      assertThat(new LobbySizing.Selection(LobbySizing.Mode.AUTO, 0).target(map, 100))
          .isEqualTo(sizes.large());
    }
  }

  @Test
  void footprintAndSpawnCapacityGiveUsefulTargetsForRealMaps() {
    var expected =
        java.util.Map.of(
            "training-yard",
            16,
            "the-red-sand-seas",
            24,
            "apex-expanse",
            72,
            "the-lost-kingdom",
            48,
            "mountains",
            8);
    for (var source : content.maps()) {
      if (expected.containsKey(source.id())) {
        assertThat(LobbySizing.recommend(source.definition(), 100).large())
            .as(source.id())
            .isEqualTo(expected.get(source.id()));
      }
    }
  }

  @Test
  void recordingIsOnWithASaltFromTheEnvironmentAndTheLoadTestIsOff() {
    assertThat(content.config().recording().enabled()).isTrue();
    assertThat(content.config().recording().saltEnv()).isEqualTo("RWF_RECORDING_SALT");
    assertThat(content.config().loadtest().enabled()).isFalse();
  }

  @Test
  void saigonAndWonderlandShipButStayOutOfTheRotation() {
    var ids = content.maps().stream().map(MapSource::id).toList();
    assertThat(ids).containsAll(content.config().quarantine().keySet());
    assertThat(content.config().quarantine()).containsOnlyKeys("saigon", "wonderland");
    assertThat(content.config().quarantine().values())
        .allMatch(r -> r.startsWith("BOMB_UNREACHABLE"));
    assertThat(content.rotation())
        .hasSize(32)
        .extracting(MapSource::id)
        .doesNotContain("saigon", "wonderland")
        .contains("training-yard");
  }

  @Test
  void theKitsFileMirrorsTheKitBook() {
    assertThat(content.kits()).isEqualTo(KitBook.MILESTONE_ONE);
  }

  @Test
  void theTrainingYardIsATwoTeamMapWithANuke() {
    assertThat(content.maps()).hasSize(34);
    assertThat(content.maps()).extracting(MapSource::id).contains("training-yard");
    assertThat(trainingYard.definition().teamColors())
        .containsExactly(TeamColor.RED, TeamColor.BLUE);
    assertThat(trainingYard.definition().hasNuke()).isTrue();
    assertThat(trainingYard.definition().bombs()).hasSize(3);
    assertThat(trainingYard.blocks().schematic().size())
        .isEqualTo(new Schematic.Dimensions(64, 16, 64));
  }

  @Test
  void theShippedSchematicIsExactlyWhatTheGeneratorProduces() {
    var generated = TrainingYard.generate();
    var shipped = trainingYard.blocks().schematic();

    assertThat(shipped.sha256()).isEqualTo(generated.sha256());
    assertThat(shipped.palette()).isEqualTo(generated.palette());
    assertThat(read(SHIPPED.resolve("rwf/maps/training-yard/blocks.schem")))
        .isEqualTo(SchematicWriter.write(generated));
  }

  @Test
  void theLobbyIsTheGeneratedRoomWithAnAlcovePerKit() {
    var lobby = content.lobby();
    var generated = generatedLobby();

    assertThat(lobby.layout()).isEqualTo(LobbyBuild.layout());
    assertThat(lobby.layout().kits())
        .isEqualTo(KitBook.MILESTONE_ONE.stream().map(kit -> kit.id()).toList());
    assertThat(lobby.blocksSha256()).isEqualTo(generated.sha256());
    assertThat(lobby.blocks().schematic().sha256()).isEqualTo(generated.sha256());
    assertThat(read(SHIPPED.resolve("rwf/lobby/blocks.schem")))
        .isEqualTo(SchematicWriter.write(generated));
  }

  @Test
  void theLobbySpawnStandsOnTheGoldPadAwayFromEveryMap() {
    var lobby = content.lobby();
    var feet = lobby.layout().spawn().position().toBlock();

    assertThat(lobby.blocks().at(feet.plus(0, -1, 0)).getAsString())
        .isEqualTo("minecraft:gold_block");
    assertThat(lobby.layout().region().contains(trainingYard.definition().border().min()))
        .isFalse();
  }

  /** The schematic the lobby generator builds. */
  static Schematic generatedLobby() {
    return new Schematic(
        new Schematic.Dimensions(LobbyBuild.WIDTH, LobbyBuild.HEIGHT, LobbyBuild.LENGTH),
        LobbyBuild.PALETTE,
        LobbyBuild.generate().indices());
  }

  private static byte[] read(Path file) {
    try {
      return Files.readAllBytes(file);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }
}
