package com.shepherdjerred.thestorm.tools.rwfmap;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavCodec;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/**
 * Every map the server ships bakes deterministically into a playable artifact that decodes, carries
 * the schematic hash rwf verifies the world against, and is what the repository has committed.
 */
final class ShippedMapsTest {

  /** {@code rwf/maps} as the repository owns it; the Gradle build passes the path. */
  static final Path MAPS = Path.of(System.getProperty("thestorm.rwf.maps"));

  static Stream<Path> shippedMaps() {
    try (var listing = Files.list(MAPS)) {
      var folders = listing.filter(Files::isDirectory).sorted().toList();
      assertThat(folders).as("shipped maps under %s", MAPS).isNotEmpty();
      return folders.stream();
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  @MethodSource("shippedMaps")
  @ParameterizedTest
  void bakesToAPlayableArtifactWithTheSchematicHash(Path folder) {
    var map = MapFolder.load(folder);
    var baked = Baker.bake(map);

    assertThat(baked.problems()).isEmpty();
    assertThat(baked.artifact().blocksSha256())
        .isEqualTo(map.definition().blocksSha256())
        .isEqualTo(map.schematic().sha256());
    assertThat(baked.artifact().mapId()).isEqualTo(folder.getFileName().toString());
    var decoded = NavCodec.decode(baked.bytes());
    assertThat(decoded).isInstanceOf(Result.Ok.class);
    var artifact = ((Result.Ok<NavArtifact, NavCodec.CodecError>) decoded).value();
    assertThat(artifact).isEqualTo(baked.artifact());
    assertThat(artifact.validate()).isEmpty();
  }

  @MethodSource("shippedMaps")
  @ParameterizedTest
  void bakingTwiceGivesIdenticalBytes(Path folder) {
    var map = MapFolder.load(folder);
    var first = Baker.bake(map);
    var second = Baker.bake(MapFolder.load(folder));

    assertThat(second.bytes()).isEqualTo(first.bytes());
    assertThat(second.summary()).isEqualTo(first.summary());
  }

  @MethodSource("shippedMaps")
  @ParameterizedTest
  void theCommittedNavFilesAreCurrent(Path folder) throws IOException {
    var map = MapFolder.load(folder);
    var baked = Baker.bake(map);

    assertThat(Verifier.verify(map)).isEmpty();
    assertThat(Files.readAllBytes(map.navFile())).isEqualTo(baked.bytes());
    assertThat(Files.readString(map.summaryFile(), UTF_8)).isEqualTo(baked.summary());
  }

  @MethodSource("shippedMaps")
  @ParameterizedTest
  void everySpawnReachesEveryBombAlongARoute(Path folder) {
    var baked = Baker.bake(MapFolder.load(folder));
    var sites = baked.artifact().sites();

    for (var spawn : sites.spawns()) {
      for (var bomb : sites.bombs()) {
        assertThat(baked.artifact().routes().between(spawn.name(), bomb.name()))
            .as("%s -> %s", spawn.name(), bomb.name())
            .isNotEmpty();
      }
    }
    assertThat(baked.artifact().distanceFields().keySet())
        .contains(sites.spawns().stream().map(site -> site.name()).toArray(String[]::new));
  }
}
