package com.shepherdjerred.thestorm.essentials.adapter.files;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.compute.ComputePool;
import java.io.DataOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executor;
import java.util.zip.GZIPOutputStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class SavedRespawnTest {

  private static final UUID ALICE = UUID.fromString("00000000-0000-0000-0000-00000000000a");

  @Test
  void aPlayerFileWithoutARespawnHasNoBed() {
    assertThat(SavedRespawn.read(Map.of())).isEmpty();
  }

  @Test
  void aRespawnIsOneDimensionAndBlock() throws IOException {
    var spot = new SavedRespawn.Spot("minecraft:overworld", 12, 64, -4, 90f);
    assertThat(SavedRespawn.read(root(spot))).contains(spot);
  }

  @Test
  void aMalformedRespawnFailsInsteadOfGuessing() {
    assertThatThrownBy(() -> SavedRespawn.read(Map.of("respawn", Map.of())))
        .isInstanceOf(IllegalStateException.class);
  }

  @Test
  void playerFilesAreReadAndUnrelatedFilesAreIgnored(@TempDir Path directory) throws IOException {
    var spot = new SavedRespawn.Spot("minecraft:the_nether", 3, 70, 8, -45f);
    write(directory.resolve(ALICE + ".dat"), root(spot));
    Files.writeString(directory.resolve("notes.txt"), "no");
    Files.writeString(directory.resolve("not-a-uuid.dat"), "no");

    var scan = SavedRespawn.readAll(directory);

    assertThat(scan.problems()).isEmpty();
    assertThat(scan.found()).containsExactly(new SavedRespawn.Found(ALICE, spot));
  }

  @Test
  void folderDiscoveryAndFileReadingWaitForTheComputePool(@TempDir Path directory)
      throws IOException {
    var tasks = new ArrayDeque<Runnable>();
    var compute =
        new ComputePool() {
          @Override
          public Executor executor() {
            return tasks::add;
          }

          @Override
          public void close() {}
        };
    var result = SavedRespawn.load(directory, compute);

    assertThat(result).isNotDone();
    var playerData = Files.createDirectories(directory.resolve("players/data"));
    var spot = new SavedRespawn.Spot("minecraft:overworld", 12, 64, -4, 90f);
    write(playerData.resolve(ALICE + ".dat"), root(spot));
    tasks.remove().run();
    assertThat(result)
        .isCompletedWithValue(
            new SavedRespawn.Scan(
                java.util.List.of(new SavedRespawn.Found(ALICE, spot)), java.util.List.of()));
  }

  @Test
  void aCorruptPlayerFileIsReportedWithoutDroppingOtherBeds(@TempDir Path directory)
      throws IOException {
    var spot = new SavedRespawn.Spot("minecraft:overworld", 12, 64, -4, 90f);
    write(directory.resolve(ALICE + ".dat"), root(spot));
    var corrupt = directory.resolve("00000000-0000-0000-0000-00000000000b.dat");
    Files.writeString(corrupt, "not compressed player data");

    var scan = SavedRespawn.readAll(directory);

    assertThat(scan.found()).containsExactly(new SavedRespawn.Found(ALICE, spot));
    assertThat(scan.problems())
        .singleElement()
        .satisfies(
            problem -> {
              assertThat(problem.file()).isEqualTo(corrupt.toString());
              assertThat(problem.failure()).isInstanceOf(java.io.UncheckedIOException.class);
            });
  }

  private static Map<String, Object> root(SavedRespawn.Spot spot) {
    return Map.of(
        "respawn",
        Map.of(
            "respawnData",
            Map.of(
                "globalPos",
                Map.of(
                    "dimension", spot.dimension(), "pos", new int[] {spot.x(), spot.y(), spot.z()}),
                "yaw",
                spot.yaw(),
                "pitch",
                0f),
            "forced",
            (byte) 0));
  }

  private static void write(Path file, Map<String, Object> root) throws IOException {
    try (var out = new DataOutputStream(new GZIPOutputStream(Files.newOutputStream(file)))) {
      out.writeByte(10);
      out.writeUTF("");
      writeCompound(out, root);
    }
  }

  private static void writeCompound(DataOutputStream out, Map<String, Object> compound)
      throws IOException {
    for (var entry : compound.entrySet()) {
      writeTag(out, entry.getKey(), entry.getValue());
    }
    out.writeByte(0);
  }

  private static void writeTag(DataOutputStream out, String name, Object value) throws IOException {
    switch (value) {
      case String text -> {
        out.writeByte(8);
        out.writeUTF(name);
        out.writeUTF(text);
      }
      case Float number -> {
        out.writeByte(5);
        out.writeUTF(name);
        out.writeFloat(number);
      }
      case Byte number -> {
        out.writeByte(1);
        out.writeUTF(name);
        out.writeByte(number);
      }
      case int[] coords -> {
        out.writeByte(11);
        out.writeUTF(name);
        out.writeInt(coords.length);
        for (var coord : coords) {
          out.writeInt(coord);
        }
      }
      case Map<?, ?> nested -> {
        out.writeByte(10);
        out.writeUTF(name);
        var compound = new java.util.LinkedHashMap<String, Object>();
        for (var entry : nested.entrySet()) {
          compound.put((String) entry.getKey(), entry.getValue());
        }
        writeCompound(out, compound);
      }
      default -> throw new IllegalArgumentException(value.getClass().getName());
    }
  }
}
