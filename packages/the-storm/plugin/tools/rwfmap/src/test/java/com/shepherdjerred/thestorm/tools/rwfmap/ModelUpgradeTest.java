package com.shepherdjerred.thestorm.tools.rwfmap;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.map.NavCodec;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.io.PrintStream;
import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.zip.DeflaterOutputStream;
import java.util.zip.InflaterInputStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class ModelUpgradeTest {
  @TempDir Path directory;

  @Test
  void explicitPrivateFolderUpgradeMatchesTheCanonicalFreshBakeWithoutOtherWrites()
      throws IOException {
    var folder = copied();
    var baked = Baker.bake(MapFolder.load(folder));
    model3(folder, baked);
    var bytes = new ByteArrayOutputStream();
    var errors = new ByteArrayOutputStream();

    assertThat(
            RwfMap.run(
                new String[] {"upgrade-model3", folder.toString()},
                new PrintStream(bytes, true, UTF_8),
                new PrintStream(errors, true, UTF_8)))
        .isEqualTo(RwfMap.OK);

    assertThat(Files.readAllBytes(folder.resolve(MapFolder.NAV_FILE))).isEqualTo(baked.bytes());
    assertThat(Files.readString(folder.resolve(MapFolder.SUMMARY_FILE))).isEqualTo(baked.summary());
    assertThat(bytes.toString(UTF_8))
        .contains("\"preserved\"", "\"climbableNodes\"", "\"sourceArtifact\"");
    try (var files = Files.list(folder)) {
      assertThat(files.map(path -> path.getFileName().toString()))
          .containsExactlyInAnyOrder(
              "map.yml", "blocks.schem", "details.json", "nav.rwfnav", "nav.summary.json");
    }
  }

  @Test
  void classificationSummaryMismatchFailsBeforeEitherNavigationFileChanges() throws IOException {
    var folder = copied();
    var baked = Baker.bake(MapFolder.load(folder));
    model3(folder, baked);
    var summary = Files.readString(folder.resolve(MapFolder.SUMMARY_FILE));
    var classification =
        com.shepherdjerred.thestorm.rwfbots.domain.map.MapBaker.sha256(
            MapFolder.load(folder).classify());
    var corrupt = summary.replace(classification, "0".repeat(64));
    Files.writeString(folder.resolve(MapFolder.SUMMARY_FILE), corrupt);
    var before = Files.readAllBytes(folder.resolve(MapFolder.NAV_FILE));
    var errors = new ByteArrayOutputStream();
    var output = new ByteArrayOutputStream();

    assertThat(
            RwfMap.run(
                new String[] {"upgrade-model3", folder.toString()},
                new PrintStream(output, true, UTF_8),
                new PrintStream(errors, true, UTF_8)))
        .isEqualTo(RwfMap.FAILED);
    assertThat(errors.toString(UTF_8)).contains("legacy classification hash");
    assertThat(Files.readAllBytes(folder.resolve(MapFolder.NAV_FILE))).isEqualTo(before);
    assertThat(Files.readString(folder.resolve(MapFolder.SUMMARY_FILE))).isEqualTo(corrupt);
  }

  private Path copied() throws IOException {
    var folder = Files.createDirectory(directory.resolve("training-yard"));
    for (var file : List.of("map.yml", "blocks.schem", "details.json"))
      Files.copy(ShippedMapsTest.MAPS.resolve("training-yard").resolve(file), folder.resolve(file));
    return folder;
  }

  /** Explicit synthetic model-3 fixture, formed by removing only model-4's required graph tail. */
  private static void model3(Path folder, Baker.Baked baked) throws IOException {
    var current = baked.bytes();
    byte[] raw;
    try (var in =
        new InflaterInputStream(new ByteArrayInputStream(current, 16, current.length - 16))) {
      raw = in.readAllBytes();
    }
    var graph = 0;
    while (ByteBuffer.wrap(raw).getInt(graph) != 4)
      graph += 8 + ByteBuffer.wrap(raw).getInt(graph + 4);
    var length = ByteBuffer.wrap(raw).getInt(graph + 4);
    var tail =
        Integer.BYTES + Long.BYTES * baked.artifact().graph().climbableNodes().toLongArray().length;
    var boundary = graph + 8 + length;
    var legacy = new byte[raw.length - tail];
    System.arraycopy(raw, 0, legacy, 0, boundary - tail);
    System.arraycopy(raw, boundary, legacy, boundary - tail, raw.length - boundary);
    ByteBuffer.wrap(legacy).putInt(graph + 4, length - tail).putInt(8, 3).putInt(12, 3);
    var compressed = new ByteArrayOutputStream();
    try (var zip = new DeflaterOutputStream(compressed)) {
      zip.write(legacy);
    }
    var output = new ByteArrayOutputStream();
    var header = new DataOutputStream(output);
    header.writeInt(NavCodec.MAGIC);
    header.writeInt(NavCodec.FORMAT_VERSION);
    header.writeInt(legacy.length);
    header.writeInt(compressed.size());
    compressed.writeTo(output);
    var oldBytes = output.toByteArray();
    Files.write(folder.resolve(MapFolder.NAV_FILE), oldBytes);
    Files.writeString(
        folder.resolve(MapFolder.SUMMARY_FILE),
        baked
            .summary()
            .replace("\"generatorVersion\": 4,", "\"generatorVersion\": 3,")
            .replace("\"movementModelVersion\": 4,", "\"movementModelVersion\": 3,")
            .replace("\"bytes\": " + current.length, "\"bytes\": " + oldBytes.length));
  }
}
