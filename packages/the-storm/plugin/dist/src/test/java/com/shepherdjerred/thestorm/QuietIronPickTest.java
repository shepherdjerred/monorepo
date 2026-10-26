package com.shepherdjerred.thestorm;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
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
}
