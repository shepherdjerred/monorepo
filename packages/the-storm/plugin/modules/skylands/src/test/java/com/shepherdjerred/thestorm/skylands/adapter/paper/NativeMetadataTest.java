package com.shepherdjerred.thestorm.skylands.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

final class NativeMetadataTest {
  @Test
  void exportedNativeMetadataLoadsAllFamiliesAndTheirSockets() {
    var catalog = NativeSkyConnectors.LINKS;
    assertThat(catalog).hasSize(226);
    for (var family : java.util.List.of("plains", "desert", "savanna", "snowy", "taiga")) {
      assertThat(catalog.keySet())
          .anyMatch(k -> k.startsWith("village/" + family + "/town_centers/"));
      assertThat(catalog.keySet()).anyMatch(k -> k.startsWith("village/" + family + "/houses/"));
    }
    assertThat(catalog.get("ancient_city/city_center/city_center_1"))
        .anyMatch(c -> c.join().target().equals("minecraft:connect_bottom"));
    assertThat(catalog.get("ancient_city/city_center/walls/bottom_1"))
        .anyMatch(c -> c.join().name().equals("minecraft:connect_bottom"));
  }
}
