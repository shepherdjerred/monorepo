package com.shepherdjerred.thestorm.core.material;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Objects;
import org.bukkit.Material;
import org.junit.jupiter.api.Test;

final class LegacyItemKeysTest {
  @Test
  void everyLegacyVariantResolvesToAnExistingModernMaterial() throws Exception {
    try (var reader =
        new BufferedReader(
            new InputStreamReader(
                Objects.requireNonNull(getClass().getResourceAsStream("/legacy-items.csv")),
                StandardCharsets.UTF_8))) {
      for (var line :
          reader.lines().filter(value -> !value.isBlank() && !value.startsWith("#")).toList()) {
        var fields = line.split(",", -1);
        assertThat(LegacyItemKeys.resolve(fields[0])).contains(fields[1]);
        assertThat(Material.matchMaterial(fields[1])).as(fields[0]).isNotNull();
      }
    }
    assertThat(LegacyItemKeys.resolve("295")).contains("minecraft:wheat_seeds");
    assertThat(LegacyItemKeys.resolve("351:1")).contains("minecraft:red_dye");
    assertThat(LegacyItemKeys.resolve("35:14")).contains("minecraft:red_wool");
  }
}
