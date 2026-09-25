package com.shepherdjerred.thestorm.qol.domain;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.config.StrictYaml;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import org.junit.jupiter.api.Test;

final class QolConfigTest {

  @Test
  void theShippedFileParses() throws Exception {
    var path = Path.of("../../../server/owned/plugins/TheStorm/qol.yml");
    var yaml = Files.readString(path);
    var config =
        StrictYaml.parse(path.toString(), yaml, QolConfig.class)
            .fold(
                ok -> ok,
                err -> {
                  throw new AssertionError(err.toString());
                });
    assertThat(config.freeForDuration()).isEqualTo(Duration.ofDays(7));
    assertThat(config.cost()).isEqualTo(25);
    assertThat(config.biomes()).contains("plains", "snowy_plains");
  }
}
