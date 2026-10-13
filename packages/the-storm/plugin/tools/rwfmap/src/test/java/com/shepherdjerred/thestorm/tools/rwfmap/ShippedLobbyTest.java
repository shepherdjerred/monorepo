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
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

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
    assertThat(artifact.sites().spawns())
        .extracting(NavSites.Site::name)
        .containsExactly(
            LobbyNav.SPAWN,
            LobbyNav.side("red"),
            LobbyNav.side("blue"),
            LobbyNav.side("green"),
            LobbyNav.side("purple"),
            LobbyNav.side("yellow"),
            LobbyNav.alcove("trooper"),
            LobbyNav.alcove("longbow"),
            LobbyNav.alcove("shortbow"),
            LobbyNav.alcove("rewind"),
            LobbyNav.BALCONY);
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
    var shipped = Files.readString(yaml);
    // The balcony floats in the air, and the hash no longer names the schematic.
    Files.writeString(
        yaml,
        shipped
            .replace("balcony: { x: 80.5, y: 77.0, z: 50.5", "balcony: { x: 80.5, y: 87.0, z: 50.5")
            .replaceFirst("blocksSha256: [0-9a-f]{64}", "blocksSha256: " + "0".repeat(64)));

    assertThat(Verifier.verify(LobbyFolder.load(folder)))
        .anySatisfy(failure -> assertThat(failure).contains("blocks.schem hashes to"))
        .anySatisfy(failure -> assertThat(failure).contains("y=87.0"));
  }
}
