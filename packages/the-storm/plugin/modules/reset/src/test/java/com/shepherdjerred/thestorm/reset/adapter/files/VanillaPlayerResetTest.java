package com.shepherdjerred.thestorm.reset.adapter.files;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.compute.DirectComputePool;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class VanillaPlayerResetTest {

  @Test
  void deletesCurrentLegacyStatsAndAdvancementFilesOnlyForTheTarget(@TempDir Path world)
      throws Exception {
    var player = UUID.randomUUID();
    var other = UUID.randomUUID();
    var files =
        new Path[] {
          world.resolve(Path.of("players", "data", player + ".dat")),
          world.resolve(Path.of("players", "data", player + ".dat_old")),
          world.resolve(Path.of("playerdata", player + ".dat")),
          world.resolve(Path.of("playerdata", player + ".dat_old")),
          world.resolve(Path.of("stats", player + ".json")),
          world.resolve(Path.of("advancements", player + ".json")),
          world.resolve(Path.of("players", "data", other + ".dat"))
        };
    for (var file : files) {
      Files.createDirectories(file.getParent());
      Files.writeString(file, "state");
    }

    assertThat(new VanillaPlayerReset(new DirectComputePool(), List.of(world)).erase(player))
        .succeedsWithin(Duration.ofSeconds(1));

    for (var file : files) {
      if (file.getFileName().toString().startsWith(other.toString())) {
        assertThat(file).exists();
      } else {
        assertThat(file).doesNotExist();
      }
    }
  }
}
