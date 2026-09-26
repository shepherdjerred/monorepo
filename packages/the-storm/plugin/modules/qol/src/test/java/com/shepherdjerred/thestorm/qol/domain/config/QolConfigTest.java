package com.shepherdjerred.thestorm.qol.domain.config;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.config.Problem;
import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.core.result.Result;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

final class QolConfigTest {

  /** The file the server ships, relative to this module's project directory. */
  static final Path SHIPPED = Path.of("../../../server/owned/plugins/TheStorm/qol.yml");

  static String shipped() throws IOException {
    return Files.readString(SHIPPED);
  }

  static Result<QolConfig, List<Problem>> parse(String yaml) {
    return StrictYaml.parse("qol.yml", yaml, QolConfig.class);
  }

  @Test
  void theShippedFileParses() throws IOException {
    var config =
        parse(shipped())
            .fold(
                parsed -> parsed,
                problems -> {
                  throw new AssertionError(problems);
                });

    assertThat(config.graves().lockedFor()).isEqualTo(Duration.ofMinutes(15));
    assertThat(config.graves().policy().expireAfter()).isEqualTo(Duration.ofDays(3));
    assertThat(config.combat().tagFor()).isEqualTo(Duration.ofSeconds(15));
    assertThat(config.combat().killOnLogout()).isTrue();
    assertThat(config.sleep().percent()).isEqualTo(50);
    assertThat(config.sort().sneakPunch()).isTrue();
  }

  @ParameterizedTest
  @CsvSource(
      delimiter = '|',
      value = {
        "lockedFor: PT15M|lockedFor: PT-1M|negative",
        "expireAfter: PT72H|expireAfter: PT10M|longer",
        "searchRadius: 4|searchRadius: 0|searchRadius",
        "searchRadius: 4|searchRadius: 9|searchRadius",
        "tagFor: PT15S|tagFor: PT0S|tagFor",
        "{player} logged out|Someone logged out|{player}",
        "percent: 50|percent: 0|percent",
        "percent: 50|percent: 101|percent",
        "\"The night passes. Good morning!\"|\" \"|morningMessage",
        "sneakPunch: true|sneakPunch: sometimes|sneakPunch",
      })
  void badValuesAreRejected(String from, String to, String mentioned) throws IOException {
    var problems = parse(shipped().replace(from, to)).fold(config -> List.<Problem>of(), p -> p);
    assertThat(problems).anySatisfy(p -> assertThat(p.toString()).contains(mentioned));
  }

  @Test
  void unknownAndMissingKeysAreRejected() throws IOException {
    assertThat(parse(shipped() + "\nextra: 1\n").isOk()).isFalse();
    assertThat(parse(shipped().replace("  killOnLogout: true\n", "")).isOk()).isFalse();
  }
}
