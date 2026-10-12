package com.shepherdjerred.thestorm.tools.rwfmap;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwf.domain.lobby.LobbyBuild;
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
 * The shipped lobby is exactly what its generator builds, and it bakes deterministically into a
 * usable artifact whose every place the spawn reaches: the alcoves, both sides and the balcony.
 */
final class ShippedLobbyTest {

  /** {@code rwf/lobby} as the repository owns it; the Gradle build passes the path. */
  static final Path LOBBY = Path.of(System.getProperty("thestorm.rwf.lobby"));

  @TempDir Path temp;

  @Test
  void theCommittedFilesAreWhatTheGeneratorAndAFreshBakeProduce() throws IOException {
    var lobby = LobbyFolder.load(LOBBY);
    var baked = Baker.bake(lobby);

    assertThat(Verifier.verify(lobby)).isEmpty();
    assertThat(Files.readAllBytes(lobby.blocksFile())).isEqualTo(LobbyFolder.generatedBytes());
    assertThat(lobby.layout()).isEqualTo(LobbyBuild.layout());
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
    assertThat(artifact.blocksSha256()).isEqualTo(LobbyFolder.generated().sha256());
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
  void verifyingFailsWhenTheLayoutOrTheSchematicDrifts() throws IOException {
    var folder = temp.resolve("lobby");
    Files.createDirectories(folder);
    for (var name :
        new String[] {
          LobbyFolder.LOBBY_FILE, MapFolder.BLOCKS_FILE, MapFolder.NAV_FILE, MapFolder.SUMMARY_FILE
        }) {
      Files.copy(LOBBY.resolve(name), folder.resolve(name));
    }
    var yaml = folder.resolve(LobbyFolder.LOBBY_FILE);
    Files.writeString(yaml, Files.readString(yaml).replace("name: Waiting Room", "name: Hall"));

    assertThat(Verifier.verify(LobbyFolder.load(folder)))
        .singleElement()
        .satisfies(failure -> assertThat(failure).contains("LobbyBuild lays the room out"));
  }
}
