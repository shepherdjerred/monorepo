package com.shepherdjerred.thestorm.rwfbots.adapter.content;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The shipped rwfbots.yml parses, its lever table is pinned, and a drift refuses to load. */
final class RwfBotsConfigTest {

  @TempDir Path directory;

  private static Path shipped() {
    var path = System.getProperty("thestorm.rwfbots.config");
    assertThat(path).as("the build passes the shipped config").isNotNull();
    return Path.of(path);
  }

  @Test
  void theShippedConfigLoads() {
    var config = ConfigFiles.load(shipped(), RwfBotsConfig.class);

    assertThat(config.thinkRates().perceptionEveryTicks()).isEqualTo(2);
    assertThat(config.thinkRates().tacticsEveryTicks()).isEqualTo(5);
    assertThat(config.governor().toSettings().level1Mspt()).isEqualTo(40);
    assertThat(config.draft().availableKits())
        .containsExactlyInAnyOrder(Kit.TROOPER, Kit.LONGBOW, Kit.SHORTBOW, Kit.REWIND);
    assertThat(config.traces().enabled()).isTrue();
    assertThat(config.traces().directory()).isEqualTo("rwfbots-traces");
  }

  @Test
  void aLeverCurveThatDisagreesWithTheCodeIsRefused() throws IOException {
    var yaml = Files.readString(shipped()).replace("exponent: 0.85", "exponent: 0.9");
    var file = directory.resolve("rwfbots.yml");
    Files.writeString(file, yaml);

    assertThatThrownBy(() -> ConfigFiles.load(file, RwfBotsConfig.class))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("reactionMs is pinned");
  }

  @Test
  void anUnknownKitIsRefused() throws IOException {
    var yaml = Files.readString(shipped()).replace("kits: [trooper", "kits: [paladin, trooper");
    var file = directory.resolve("rwfbots.yml");
    Files.writeString(file, yaml);

    assertThatThrownBy(() -> ConfigFiles.load(file, RwfBotsConfig.class))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("PALADIN");
  }
}
