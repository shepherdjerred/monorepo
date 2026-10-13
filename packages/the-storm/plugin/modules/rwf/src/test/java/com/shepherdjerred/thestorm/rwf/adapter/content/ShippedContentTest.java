package com.shepherdjerred.thestorm.rwf.adapter.content;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitRotation;
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
  static void load() throws IOException {
    MockBukkit.mock();
    content = ContentFiles.catalog(staged(), Bukkit::createBlockData);
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
    assertThat(content.config().worlds())
        .isEqualTo(
            new com.shepherdjerred.thestorm.rwf.adapter.content.RwfConfig.Worlds(
                "rwf_lobby", "rwf", RwfConfig.LobbyProvisioning.OWNED_VOID));
    assertThat(content.config().match().minHumans()).isEqualTo(1);
    // Red Warfare's lobby: 4 players, one fewer every 15 s, never under 2.
    assertThat(content.config().match().minPlayers()).isEqualTo(4);
    assertThat(content.config().match().absoluteMinPlayers()).isEqualTo(2);
    assertThat(content.config().matchSettings().requiredPlayers(Duration.ofSeconds(15)))
        .isEqualTo(3);
    assertThat(content.config().matchSettings().requiredPlayers(Duration.ofMinutes(5)))
        .isEqualTo(2);
    assertThat(content.config().match().countdown()).isEqualTo(Duration.ofSeconds(90));
    assertThat(content.config().match().maxCombatants()).isEqualTo(100);
    assertThat(content.config().match().automaticSizing()).isTrue();
    assertThat(content.config().experience())
        .isEqualTo(com.shepherdjerred.thestorm.rwf.app.ExperienceSettings.DEFAULT);
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
    assertThat(content.kits()).isEqualTo(KitBook.ALL);
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
  void theLobbyIsTheAuthoredBuildWithAnAlcovePerKitAndThreePodiums() {
    var layout = shippedLobby();
    var declared =
        com.shepherdjerred.thestorm.core.config.ConfigFiles.load(
                SHIPPED.resolve("rwf/lobby/lobby.yml"), LobbyFile.class)
            .blocksSha256();

    assertThat(layout.kits())
        .containsExactlyInAnyOrderElementsOf(KitBook.ALL.stream().map(kit -> kit.id()).toList());
    assertThat(layout.rotation().slots()).hasSize(KitRotation.SIZE);
    assertThat(layout.podiums()).hasSize(3);
    assertThat(layout.leaderboards()).hasSize(3);
    assertThat(declared).isEqualTo(shippedLobbyBlocks().sha256());
  }

  @Test
  void theLobbySpawnStandsOnTheDeckAndEachPodiumIsALodestone() {
    var layout = shippedLobby();
    var blocks = shippedLobbyBlocks();
    var min = layout.region().min();
    java.util.function.Function<com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos, String>
        at =
            pos ->
                blocks
                    .palette()
                    .get(
                        blocks.paletteIndex(
                            pos.x() - min.x(), pos.y() - min.y(), pos.z() - min.z()));
    var feet = layout.spawn().position().toBlock();

    assertThat(at.apply(feet.plus(0, -1, 0))).isNotEqualTo("minecraft:air");
    assertThat(at.apply(feet)).isEqualTo("minecraft:air");
    for (var podium : layout.podiums()) {
      assertThat(at.apply(podium.click())).isEqualTo("minecraft:lodestone");
    }
  }

  /**
   * The shipped content with the suites' test lobby in place of the war room: MockBukkit cannot
   * make block data for the war room's walls, panes and lanterns, so its places and hash are
   * checked here without block data, and its blocks by rwfmap and the real-server suites.
   */
  private static Path staged() throws IOException {
    var root = Files.createTempDirectory("rwf-shipped");
    var rwf = Files.createDirectories(root.resolve("rwf"));
    Files.createSymbolicLink(root.resolve("rwf.yml"), SHIPPED.resolve("rwf.yml").toAbsolutePath());
    Files.createSymbolicLink(
        rwf.resolve("kits.yml"), SHIPPED.resolve("rwf/kits.yml").toAbsolutePath());
    Files.createSymbolicLink(rwf.resolve("maps"), SHIPPED.resolve("rwf/maps").toAbsolutePath());
    Files.createSymbolicLink(
        rwf.resolve("lobby"),
        com.shepherdjerred.thestorm.rwf.RwfHarness.FIXTURE_LOBBY.toAbsolutePath());
    return root;
  }

  /** The shipped lobby's places, read without block data. */
  private static com.shepherdjerred.thestorm.rwf.domain.lobby.LobbyLayout shippedLobby() {
    return com.shepherdjerred.thestorm.core.config.ConfigFiles.load(
            SHIPPED.resolve("rwf/lobby/lobby.yml"), LobbyFile.class)
        .toLayout();
  }

  /** The shipped lobby's schematic. */
  private static Schematic shippedLobbyBlocks() {
    try (var in = Files.newInputStream(SHIPPED.resolve("rwf/lobby/blocks.schem"))) {
      return SchematicReader.read(in);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  private static byte[] read(Path file) {
    try {
      return Files.readAllBytes(file);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }
}
