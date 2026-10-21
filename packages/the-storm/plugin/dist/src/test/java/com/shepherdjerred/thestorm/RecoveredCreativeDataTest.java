package com.shepherdjerred.thestorm;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class RecoveredCreativeDataTest {
  @TempDir Path container;

  @Test
  void missingTerrainNeverCreatesAReplacement() {
    assertThatThrownBy(() -> RecoveredCreativeData.require(container, "creative"))
        .isInstanceOf(IllegalStateException.class);
    assertThat(container.resolve("creative")).doesNotExist();
  }

  @Test
  void acceptsTheLegacyArchiveAndTheNativeStoreAfterPaperMigration() throws IOException {
    var region = region("creative/region");
    Files.writeString(container.resolve("creative/level.dat"), "legacy metadata");
    RecoveredCreativeData.require(container, "creative");
    Files.createDirectories(container.resolve("world/dimensions/minecraft/creative/region"));
    Files.move(region, container.resolve("world/dimensions/minecraft/creative/region/r.0.0.mca"));
    Files.writeString(container.resolve("world/level.dat"), "native metadata");
    RecoveredCreativeData.require(container, "creative");
  }

  @Test
  void rejectsAmbiguousTerrainAndTruncatedRegions() throws IOException {
    var legacy = region("creative/region");
    Files.writeString(container.resolve("creative/level.dat"), "metadata");
    region("world/dimensions/minecraft/creative/region");
    assertThatThrownBy(() -> RecoveredCreativeData.require(container, "creative"))
        .isInstanceOf(IllegalStateException.class);
    Files.write(legacy, new byte[100]);
    assertThatThrownBy(() -> RecoveredCreativeData.require(container, "creative"))
        .hasMessageContaining("invalid region");
  }

  @Test
  void rejectsLinkedDataAndNamesOutsideTheWorldContainer() throws IOException {
    region("creative/region");
    Files.writeString(container.resolve("outside.dat"), "metadata");
    Files.createSymbolicLink(
        container.resolve("creative/level.dat"), container.resolve("outside.dat"));
    assertThatThrownBy(() -> RecoveredCreativeData.require(container, "creative"))
        .isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(() -> RecoveredCreativeData.require(container, "../creative"))
        .isInstanceOf(IllegalStateException.class);
  }

  private Path region(String relative) throws IOException {
    var directory = Files.createDirectories(container.resolve(relative));
    return Files.write(directory.resolve("r.0.0.mca"), new byte[8192]);
  }
}
