package com.shepherdjerred.thestorm.rwfbots.adapter.content;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Lines;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Voice;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * The shipped rwfbots.yml parses, its lever table is pinned, a drift refuses to load, and its chat
 * section is checked at load.
 */
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

  @Test
  void theShippedChatSectionLoads() {
    var chat = ConfigFiles.load(shipped(), RwfBotsConfig.class).chat();

    assertThat(chat.enabled()).isTrue();
    assertThat(chat.flagRefreshSeconds()).isEqualTo(30);
    var settings = chat.toSettings();
    assertThat(settings.chance(Lines.Moment.ON_KILL)).isEqualTo(0.4);
    assertThat(settings.chance(Lines.Moment.TAUNT)).isEqualTo(0.3);
    assertThat(settings.verbosity(Voice.Verbosity.QUIET)).isEqualTo(0.4);
    assertThat(settings.verbosity(Voice.Verbosity.CHATTY)).isEqualTo(1.6);
    assertThat(settings.maxLinesPerWindow()).isEqualTo(4);
    assertThat(settings.window()).isEqualTo(Duration.ofSeconds(10));
    assertThat(settings.minGap()).isEqualTo(Duration.ofMillis(1500));
    assertThat(settings.botCooldown()).isEqualTo(Duration.ofSeconds(20));
    assertThat(settings.maxDelay()).isGreaterThanOrEqualTo(settings.reactionMax());
  }

  @Test
  void aChatChanceAboveOneIsRefusedAtLoad() throws IOException {
    var yaml = Files.readString(shipped()).replace("    taunt: 0.3", "    taunt: 1.3");
    var file = directory.resolve("rwfbots.yml");
    Files.writeString(file, yaml);

    assertThatThrownBy(() -> ConfigFiles.load(file, RwfBotsConfig.class))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("taunt must be 0..1");
  }

  @Test
  void aChatSectionWithAnUnknownKeyIsRefused() throws IOException {
    var yaml =
        Files.readString(shipped())
            .replace("  rivalBoost: 2.0", "  rivalBoost: 2.0\n  shout: true");
    var file = directory.resolve("rwfbots.yml");
    Files.writeString(file, yaml);

    assertThatThrownBy(() -> ConfigFiles.load(file, RwfBotsConfig.class))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("shout");
  }
}
