package com.shepherdjerred.thestorm.world.domain;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.config.StrictYaml;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

final class WorldConfigTest {

  @Test
  void theShippedFileParses() throws Exception {
    var path = Path.of("../../../server/owned/plugins/TheStorm/world.yml");
    var yaml = Files.readString(path);
    var config =
        StrictYaml.parse(path.toString(), yaml, WorldConfig.class)
            .fold(
                ok -> ok,
                err -> {
                  throw new AssertionError(err.toString());
                });
    assertThat(config.sleepPercentage()).isEqualTo(50);
    assertThat(config.worlds()).extracting(WorldSpec::name).containsExactly("wilds", "peaks");
    assertThat(SleepFraction.skips(1, 2, config.sleepPercentage())).isTrue();
  }
}
