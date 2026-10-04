package com.shepherdjerred.thestorm.tools.rwfmap;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.PrintStream;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class RwfMapTest {

  @TempDir Path temp;

  private final ByteArrayOutputStream out = new ByteArrayOutputStream();
  private final ByteArrayOutputStream err = new ByteArrayOutputStream();

  private int run(String... args) {
    return RwfMap.run(args, new PrintStream(out, true, UTF_8), new PrintStream(err, true, UTF_8));
  }

  private String err() {
    return err.toString(UTF_8);
  }

  @Test
  void missingArgumentsPrintUsage() {
    assertThat(run()).isEqualTo(RwfMap.USAGE);
    assertThat(run("bake")).isEqualTo(RwfMap.USAGE);
    assertThat(run("frobnicate", "x")).isEqualTo(RwfMap.USAGE);
    assertThat(run("verify", "x", "--out", "y")).isEqualTo(RwfMap.USAGE);
    assertThat(run("bake", "x", "--outt", "y")).isEqualTo(RwfMap.USAGE);
    assertThat(err()).contains("usage:");
  }

  @Test
  void bakeWritesTheArtifactToOutAndTheSummaryBesideIt() throws IOException {
    var shipped = ShippedMapsTest.MAPS.resolve("training-yard");
    var target = temp.resolve("out/training.rwfnav");

    var code = run("bake", shipped.toString(), "--out", target.toString());

    assertThat(code).as(err()).isEqualTo(RwfMap.OK);
    assertThat(Files.readAllBytes(target))
        .isEqualTo(Files.readAllBytes(shipped.resolve(MapFolder.NAV_FILE)));
    assertThat(Files.readString(temp.resolve("out/training.rwfnav.summary.json")))
        .isEqualTo(Files.readString(shipped.resolve(MapFolder.SUMMARY_FILE)));
    assertThat(out.toString(UTF_8)).startsWith("baked training-yard:");
  }

  @Test
  void verifyPassesOnTheShippedMap() {
    var shipped = ShippedMapsTest.MAPS.resolve("training-yard");

    assertThat(run("verify", shipped.toString())).as(err()).isEqualTo(RwfMap.OK);
    assertThat(out.toString(UTF_8)).startsWith("verified training-yard");
  }

  @Test
  void verifyFailsOnAMisnamedFolder() throws IOException {
    var shipped = ShippedMapsTest.MAPS.resolve("training-yard");
    var folder = temp.resolve("not-the-training-yard");
    Files.createDirectories(folder);
    Files.copy(shipped.resolve(MapFolder.MAP_FILE), folder.resolve(MapFolder.MAP_FILE));
    Files.copy(shipped.resolve(MapFolder.BLOCKS_FILE), folder.resolve(MapFolder.BLOCKS_FILE));

    assertThat(run("verify", folder.toString())).isEqualTo(RwfMap.FAILED);
    assertThat(err()).contains("the folder must be named training-yard");
  }

  @Test
  void verifyFailsWhenTheArtifactIsStale() throws IOException {
    var shipped = ShippedMapsTest.MAPS.resolve("training-yard");
    var folder = temp.resolve("training-yard");
    Files.createDirectories(folder);
    Files.copy(shipped.resolve(MapFolder.MAP_FILE), folder.resolve(MapFolder.MAP_FILE));
    Files.copy(shipped.resolve(MapFolder.BLOCKS_FILE), folder.resolve(MapFolder.BLOCKS_FILE));
    Files.write(folder.resolve(MapFolder.NAV_FILE), new byte[] {1, 2, 3});

    assertThat(run("verify", folder.toString())).isEqualTo(RwfMap.FAILED);
    assertThat(err()).contains("failed verification").contains("does not decode");
  }
}
