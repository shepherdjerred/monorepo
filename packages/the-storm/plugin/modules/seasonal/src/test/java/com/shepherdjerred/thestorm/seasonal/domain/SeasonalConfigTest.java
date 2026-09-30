package com.shepherdjerred.thestorm.seasonal.domain;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.core.config.StrictYaml;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

final class SeasonalConfigTest {

  private static final Path SHIPPED =
      Path.of("../../../server/owned/plugins/TheStorm/seasonal.yml");

  @Test
  void shippedEventsHaveAuthoredMainWorldDoors() {
    var config = ConfigFiles.load(SHIPPED, SeasonalConfig.class);

    assertThat(config.mainWorld()).isEqualTo("world");
    assertThat(config.events()).hasSize(2);
    assertThat(config.events().getFirst().id()).isEqualTo("stormnight");
    assertThat(config.events().getFirst().dailyDoors()).isEqualTo(11);
    assertThat(config.events().getFirst().doors()).hasSize(11);
    assertThat(config.events().get(1).id()).isEqualTo("winter_vigil");
    assertThat(config.events().get(1).firstDay()).isEqualTo("12-24");
    assertThat(config.events().get(1).lastDay()).isEqualTo("01-01");
    assertThat(config.events().get(1).doors()).hasSize(7);
  }

  @Test
  void unknownKeysAndInvalidWindowsFail() {
    var valid =
        """
        mainWorld: world
        timeZone: America/Los_Angeles
        events:
          - id: stormnight
            title: Stormnight
            firstDay: 10-28
            lastDay: 10-31
            spawnRadius: 64
            dailyDoors: 1
            doors:
              - {east: 1, up: 0, south: 0, material: OAK_DOOR}
            rewards:
              - {kind: TREAT, material: BREAD, amount: 1, weight: 1}
        """;

    assertThat(StrictYaml.parse("seasonal.yml", valid, SeasonalConfig.class).isOk()).isTrue();
    assertThat(
            StrictYaml.parse("seasonal.yml", valid + "extra: true\n", SeasonalConfig.class).isOk())
        .isFalse();
    assertThat(
            StrictYaml.parse("seasonal.yml", valid.replace("10-28", "13-28"), SeasonalConfig.class)
                .isOk())
        .isFalse();
    assertThat(
            StrictYaml.parse(
                    "seasonal.yml", valid.replace("east: 1", "east: 100"), SeasonalConfig.class)
                .isOk())
        .isFalse();
    assertThat(
            StrictYaml.parse(
                    "seasonal.yml",
                    valid.replace("dailyDoors: 1", "dailyDoors: 2"),
                    SeasonalConfig.class)
                .isOk())
        .isFalse();
    assertThat(
            StrictYaml.parse(
                    "seasonal.yml", valid.replace("OAK_DOOR", "OAK_TRAPDOOR"), SeasonalConfig.class)
                .isOk())
        .isFalse();
  }
}
