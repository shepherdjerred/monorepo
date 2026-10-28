package com.shepherdjerred.thestorm.skylands.domain;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.config.Problem;
import com.shepherdjerred.thestorm.core.config.StrictYaml;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

final class SkylandsConfigTest {
  static final Path SHIPPED = Path.of("../../../server/owned/plugins/TheStorm/skylands.json");
  private static final String VALID =
      """
      world: skylands
      seed: 1731
      format: layered-v1
      """;

  static List<Problem> problems(String yaml) {
    return StrictYaml.parse("skylands.json", yaml, SkylandsConfig.class)
        .fold(config -> List.of(), found -> found);
  }

  @Test
  void theShippedFileSelectsTheLayeredWorld() throws IOException {
    var config =
        StrictYaml.parse("skylands.json", Files.readString(SHIPPED), SkylandsConfig.class)
            .fold(
                parsed -> parsed,
                found -> {
                  throw new AssertionError(found);
                });
    assertThat(config).isEqualTo(new SkylandsConfig("skylands", 1731L, SkylandsConfig.FORMAT));
    assertThat(LayeredSpawn.find(new LayeredLandscape(config.seed())).y())
        .isBetween(SkylandsConfig.MIN_Y + 1, SkylandsConfig.MAX_Y - 2);
  }

  @Test
  void aCompleteFileParses() {
    assertThat(problems(VALID)).isEmpty();
  }

  @ParameterizedTest
  @ValueSource(strings = {"format: layered-v1\n", "seed: 1731\n", "world: skylands\n"})
  void everyIdentityKeyIsRequired(String line) {
    assertThat(problems(VALID.replace(line, ""))).isNotEmpty();
  }

  @ParameterizedTest
  @ValueSource(strings = {"lakes: true", "ores: []", "spawnSearchChunks: 16", "verticalOffset: 64"})
  void oldAndUnknownSettingsAreRejected(String setting) {
    assertThat(problems(VALID + setting + "\n")).isNotEmpty();
  }

  @ParameterizedTest
  @ValueSource(strings = {"", "classic", "layered-v2"})
  void otherFormatsCannotSilentlyChangeTheWorld(String format) {
    assertThat(problems(VALID.replace("layered-v1", format))).isNotEmpty();
  }

  @Test
  void theWorldNameIsAKeyPath() {
    assertThat(problems(VALID.replace("world: skylands", "world: Sky Lands"))).isNotEmpty();
  }
}
