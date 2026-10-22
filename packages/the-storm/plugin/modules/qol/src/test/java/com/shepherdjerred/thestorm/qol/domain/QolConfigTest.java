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
    var path = Path.of("../../../server/owned/plugins/TheStorm/rtp.yml");
    var yaml = Files.readString(path);
    var config =
        StrictYaml.parse(path.toString(), yaml, QolConfig.class)
            .fold(
                ok -> ok,
                err -> {
                  throw new AssertionError(err.toString());
                });
    assertThat(config.searchIntervalDuration()).isEqualTo(Duration.ofSeconds(15));
    assertThat(config.biomes()).contains("plains", "snowy_plains");
    assertThat(config.withinBorder("world")).isPresent();
    assertThat(config.withinBorder("map2")).isPresent();
    assertThat(config.withinBorder("frontier")).isEmpty();
  }

  @Test
  void aBorderSearchWorldIsListedOnce() {
    var twice =
        java.util.List.of(
            new com.shepherdjerred.thestorm.qol.domain.rtp.BorderSearch("world", 256),
            new com.shepherdjerred.thestorm.qol.domain.rtp.BorderSearch("world", 512));
    org.assertj.core.api.Assertions.assertThatThrownBy(
            () ->
                new QolConfig(
                    "PT15S", "PT5M", 24, 512, 1500, 128, 90, java.util.List.of("plains"), twice))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("listed twice");
  }
}
