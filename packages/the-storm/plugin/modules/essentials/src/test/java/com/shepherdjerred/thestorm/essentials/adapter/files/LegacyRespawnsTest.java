package com.shepherdjerred.thestorm.essentials.adapter.files;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.UUID;
import java.util.zip.GZIPOutputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class LegacyRespawnsTest {
  private static final UUID PLAYER = UUID.fromString("00000000-0000-0000-0000-00000000000a");

  @Test
  void legacyWorldIsRequiredAndPartialCoordinatesAreRejected() {
    assertThat(LegacyRespawns.read(Map.of())).isEmpty();
    assertThat(LegacyRespawns.read(Map.of("SpawnX", 1, "SpawnY", 64, "SpawnZ", -5))).isEmpty();
    assertThat(
            LegacyRespawns.read(
                Map.of("SpawnX", 1, "SpawnY", 64, "SpawnZ", -5, "SpawnWorld", "world_skylands")))
        .contains(new LegacyRespawns.Spot("world_skylands", 1, 64, -5));
    assertThatThrownBy(() -> LegacyRespawns.read(Map.of("SpawnX", 1)))
        .isInstanceOf(IllegalStateException.class);
  }

  @Test
  void readsTheSpecifiedWorldPlayerDataFromTheArchive(@TempDir Path directory) throws Exception {
    var archive = directory.resolve("archive.zip");
    var bytes = new ByteArrayOutputStream();
    try (var nbt = new DataOutputStream(new GZIPOutputStream(bytes))) {
      nbt.writeByte(10);
      nbt.writeUTF("");
      nbt.writeByte(3);
      nbt.writeUTF("SpawnX");
      nbt.writeInt(12);
      nbt.writeByte(3);
      nbt.writeUTF("SpawnY");
      nbt.writeInt(70);
      nbt.writeByte(3);
      nbt.writeUTF("SpawnZ");
      nbt.writeInt(-3);
      nbt.writeByte(8);
      nbt.writeUTF("SpawnWorld");
      nbt.writeUTF("world");
      nbt.writeByte(0);
    }
    try (var zip = new ZipOutputStream(Files.newOutputStream(archive))) {
      zip.putNextEntry(new ZipEntry("main/playerdata/" + PLAYER + ".dat"));
      zip.write(bytes.toByteArray());
      zip.closeEntry();
      zip.putNextEntry(new ZipEntry("elsewhere/playerdata/" + PLAYER + ".dat"));
      zip.write(bytes.toByteArray());
      zip.closeEntry();
    }
    assertThat(LegacyRespawns.readArchive(archive, "main").found())
        .containsExactly(
            new LegacyRespawns.Found(PLAYER, new LegacyRespawns.Spot("world", 12, 70, -3)));
  }
}
