package com.shepherdjerred.thestorm.tools.rwfmap;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavCodec;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class VerifierTest {

  @TempDir Path temp;

  private Path folder;

  @BeforeEach
  void copyTrainingYard() throws IOException {
    folder = temp.resolve("training-yard");
    Files.createDirectories(folder);
    var shipped = ShippedMapsTest.MAPS.resolve("training-yard");
    Files.copy(shipped.resolve(MapFolder.MAP_FILE), folder.resolve(MapFolder.MAP_FILE));
    Files.copy(shipped.resolve(MapFolder.BLOCKS_FILE), folder.resolve(MapFolder.BLOCKS_FILE));
    var baked = Baker.bake(MapFolder.load(folder));
    Files.write(folder.resolve(MapFolder.NAV_FILE), baked.bytes());
    Files.writeString(folder.resolve(MapFolder.SUMMARY_FILE), baked.summary());
  }

  @Test
  void aFreshBakeVerifies() {
    assertThat(Verifier.verify(MapFolder.load(folder))).isEmpty();
  }

  @Test
  void aFlippedByteIsDetected() throws IOException {
    var nav = folder.resolve(MapFolder.NAV_FILE);
    var bytes = Files.readAllBytes(nav);
    bytes[bytes.length / 2] ^= (byte) 0x40;
    Files.write(nav, bytes);

    var failures = Verifier.verify(MapFolder.load(folder));

    assertThat(failures).anyMatch(failure -> failure.contains("differs from a fresh bake"));
  }

  @Test
  void anArtifactBakedFromOtherBlocksIsDetected() throws IOException {
    var baked = Baker.bake(MapFolder.load(folder)).artifact();
    var foreign =
        new NavArtifact(
            baked.formatVersion(),
            baked.generatorVersion(),
            baked.mapId(),
            "0".repeat(64),
            baked.sites(),
            baked.grid(),
            baked.graph(),
            baked.regions(),
            baked.cover(),
            baked.chokepoints(),
            baked.routes(),
            baked.distanceFields());
    Files.write(folder.resolve(MapFolder.NAV_FILE), NavCodec.encode(foreign));

    var failures = Verifier.verify(MapFolder.load(folder));

    assertThat(failures)
        .anyMatch(failure -> failure.contains("differs from a fresh bake"))
        .anyMatch(failure -> failure.contains("was baked from blocks hashing to"));
  }

  @Test
  void missingFilesAreReported() throws IOException {
    Files.delete(folder.resolve(MapFolder.NAV_FILE));
    Files.delete(folder.resolve(MapFolder.SUMMARY_FILE));

    var failures = Verifier.verify(MapFolder.load(folder));

    assertThat(failures)
        .hasSize(2)
        .anyMatch(failure -> failure.contains(MapFolder.NAV_FILE))
        .anyMatch(failure -> failure.contains(MapFolder.SUMMARY_FILE));
  }

  @Test
  void aStaleSummaryIsReported() throws IOException {
    Files.writeString(folder.resolve(MapFolder.SUMMARY_FILE), "{}\n");

    var failures = Verifier.verify(MapFolder.load(folder));

    assertThat(failures)
        .singleElement()
        .asString()
        .contains(MapFolder.SUMMARY_FILE)
        .contains("differs");
  }
}
