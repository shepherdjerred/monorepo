package com.shepherdjerred.thestorm;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

final class QuietIronPickTest {

  @Test
  void theStarterPickaxeAdvancementStaysCompleteWithoutAnnouncing() throws IOException {
    var root = Path.of(TheStormBootstrap.packRoot());
    assertThat(Files.isDirectory(root)).isTrue();
    var pack = Files.readString(root.resolve("pack.mcmeta"));
    assertThat(pack).contains("\"min_format\": [107, 1]");

    var advancement =
        Files.readString(root.resolve("data/minecraft/advancement/story/iron_tools.json"));
    assertThat(advancement).contains("\"parent\": \"minecraft:story/smelt_iron\"");
    assertThat(advancement).contains("\"trigger\": \"minecraft:inventory_changed\"");
    assertThat(advancement).contains("\"items\": \"minecraft:iron_pickaxe\"");
    assertThat(advancement).contains("\"show_toast\": false");
    assertThat(advancement).contains("\"announce_to_chat\": false");
    assertThat(advancement).contains("\"iron_pickaxe\"");
  }

  @Test
  void stormAdvancementsShareThisPack() {
    assertThat(TheStormBootstrap.class.getResource("/datapacks/the-storm/pack.mcmeta")).isNull();
    assertThat(
            TheStormBootstrap.class.getResource(
                "/datapacks/quiet-iron-pick/data/thestorm/advancement/a_survival.json"))
        .isNotNull();
  }

  @Test
  void aPackagedJarUriKeepsTheDatapackDirectory() {
    var meta = URI.create("jar:file:/servers/TheStorm.jar!/datapacks/quiet-iron-pick/pack.mcmeta");
    assertThat(meta.isOpaque()).isTrue();
    assertThat(meta.resolve(".").toString()).isEqualTo(".");
    assertThat(TheStormBootstrap.packRoot(meta).toString())
        .isEqualTo("jar:file:/servers/TheStorm.jar!/datapacks/quiet-iron-pick/");
  }
}
