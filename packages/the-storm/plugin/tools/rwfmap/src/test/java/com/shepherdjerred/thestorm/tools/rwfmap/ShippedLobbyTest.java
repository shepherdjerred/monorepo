package com.shepherdjerred.thestorm.tools.rwfmap;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwfbots.domain.lobby.LobbyNav;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavCodec;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavSites;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.node.ObjectNode;
import tools.jackson.dataformat.yaml.YAMLMapper;

/**
 * The shipped lobby's hash, places and nav files agree, and it bakes deterministically into a
 * usable artifact whose every place the spawn reaches: the alcoves, every team's side and the
 * balcony.
 */
final class ShippedLobbyTest {

  /** {@code rwf/lobby} as the repository owns it; the Gradle build passes the path. */
  static final Path LOBBY = Path.of(System.getProperty("thestorm.rwf.lobby"));

  @TempDir Path temp;

  @Test
  void theCommittedFilesAgreeWithTheirSchematicAndAFreshBake() throws IOException {
    var lobby = LobbyFolder.load(LOBBY);
    var baked = Baker.bake(lobby);

    assertThat(Verifier.verify(lobby)).isEmpty();
    assertThat(lobby.file().blocksSha256()).isEqualTo(lobby.schematic().sha256());
    assertThat(lobby.layout().podiums()).hasSize(3);
    assertThat(Files.readAllBytes(lobby.navFile())).isEqualTo(baked.bytes());
    assertThat(Files.readString(lobby.summaryFile(), UTF_8)).isEqualTo(baked.summary());
  }

  @Test
  void theLobbyBakesTwiceToTheSameBytesAndDecodes() {
    var first = Baker.bake(LobbyFolder.load(LOBBY));
    var second = Baker.bake(LobbyFolder.load(LOBBY));

    assertThat(second.bytes()).isEqualTo(first.bytes());
    var decoded = NavCodec.decode(first.bytes());
    assertThat(decoded).isInstanceOf(Result.Ok.class);
    var artifact = ((Result.Ok<NavArtifact, NavCodec.CodecError>) decoded).value();
    assertThat(artifact.mapId()).isEqualTo(LobbyNav.ID);
    assertThat(artifact.blocksSha256()).isEqualTo(LobbyFolder.load(LOBBY).schematic().sha256());
  }

  @Test
  void theSpawnReachesEveryPlaceAndTheLobbyHasNoBombs() {
    var artifact = Baker.bake(LobbyFolder.load(LOBBY)).artifact();

    assertThat(LobbyNav.problems(artifact)).isEmpty();
    assertThat(artifact.sites().bombs()).isEmpty();
    var expected =
        new java.util.ArrayList<>(
            List.of(
                LobbyNav.SPAWN,
                LobbyNav.side("red"),
                LobbyNav.side("blue"),
                LobbyNav.side("green"),
                LobbyNav.side("purple"),
                LobbyNav.side("yellow")));
    // Every kit's alcove, all 33 of the full kit list, in the armory's order.
    var kits = LobbyFolder.load(LOBBY).layout().kits();
    assertThat(kits)
        .containsExactlyInAnyOrderElementsOf(
            com.shepherdjerred.thestorm.rwf.domain.kit.KitBook.ALL.stream()
                .map(com.shepherdjerred.thestorm.rwf.domain.kit.KitSpec::id)
                .toList());
    kits.forEach(kit -> expected.add(LobbyNav.alcove(kit)));
    expected.add(LobbyNav.BALCONY);
    assertThat(artifact.sites().spawns())
        .extracting(NavSites.Site::name)
        .containsExactlyElementsOf(expected);
  }

  @Test
  void aMapsArtifactIsNotALobby() {
    var map = Baker.bake(MapFolder.load(ShippedMapsTest.MAPS.resolve("training-yard")));

    assertThat(LobbyNav.problems(map.artifact()))
        .anyMatch(problem -> problem.contains("names map training-yard"))
        .anyMatch(problem -> problem.contains("no bombs"))
        .anyMatch(problem -> problem.contains("no " + LobbyNav.SPAWN));
  }

  @Test
  void verifyingFailsWhenTheHashOrAPlaceDrifts() throws IOException {
    var folder = temp.resolve("lobby");
    Files.createDirectories(folder);
    for (var name :
        new String[] {
          LobbyFolder.LOBBY_FILE, MapFolder.BLOCKS_FILE, MapFolder.NAV_FILE, MapFolder.SUMMARY_FILE
        }) {
      Files.copy(LOBBY.resolve(name), folder.resolve(name));
    }
    var yaml = folder.resolve(LobbyFolder.LOBBY_FILE);
    var parser = YAMLMapper.builder().build();
    var shipped = (ObjectNode) parser.readTree(Files.readString(yaml));
    // The balcony floats in the air, and the hash no longer names the schematic.
    ((ObjectNode) shipped.path("balcony")).put("y", 87.0);
    shipped.put("blocksSha256", "0".repeat(64));
    Files.writeString(yaml, parser.writeValueAsString(shipped));

    assertThat(Verifier.verify(LobbyFolder.load(folder)))
        .anySatisfy(failure -> assertThat(failure).contains("blocks.schem hashes to"))
        .anySatisfy(failure -> assertThat(failure).contains("y=87.0"));
  }
}
