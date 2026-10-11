package com.shepherdjerred.thestorm.tools.rwfmap;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.map.NavCodec;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/**
 * Every shipped map has a committed navigation payload whose framing and summary match its
 * schematic metadata. Full deterministic rebakes run through {@code verifyRwfMaps}; CI keeps this
 * suite lightweight because some maps contain millions of blocks.
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
  void hasAValidCommittedNavigationArtifact(Path folder) throws IOException {
    var map = MapFolder.load(folder);
    var navSize = Files.size(map.navFile());
    try (var nav = new DataInputStream(Files.newInputStream(map.navFile()))) {
      assertThat(nav.readInt()).isEqualTo(NavCodec.MAGIC);
      assertThat(nav.readInt()).isEqualTo(NavCodec.FORMAT_VERSION);
      assertThat(nav.readInt()).isPositive();
      assertThat(nav.readInt()).isEqualTo(navSize - 16);
    }

    var summary = Files.readString(map.summaryFile(), UTF_8);
    assertThat(summary)
        .contains("\"mapId\": \"" + map.id() + "\"")
        .contains("\"blocksSha256\": \"" + map.schematic().sha256() + "\"")
        .contains("\"bytes\": " + navSize);
  }

  @Test
  void trainingYardBakesToAPlayableArtifact() {
    var map = MapFolder.load(MAPS.resolve("training-yard"));
    var baked = Baker.bake(map);

    assertThat(baked.problems()).isEmpty();
    assertThat(baked.artifact().blocksSha256()).isEqualTo(map.schematic().sha256());
    assertThat(baked.artifact().validate()).isEmpty();
  }
}
