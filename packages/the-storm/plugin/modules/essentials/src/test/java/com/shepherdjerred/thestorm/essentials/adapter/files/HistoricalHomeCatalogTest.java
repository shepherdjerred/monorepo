package com.shepherdjerred.thestorm.essentials.adapter.files;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.BufferedReader;
import java.io.StringReader;
import org.junit.jupiter.api.Test;

final class HistoricalHomeCatalogTest {
  @Test
  void shippedCatalogContainsBothExplicitHistoricalWorlds() {
    var homes = HistoricalHomeCatalog.load();
    assertThat(homes)
        .filteredOn(home -> home.archive().equals("2015"))
        .hasSize(401)
        .allSatisfy(home -> assertThat(home.position().world()).isEqualTo("world"));
    assertThat(homes)
        .filteredOn(home -> home.archive().equals("2016"))
        .hasSize(124)
        .allSatisfy(home -> assertThat(home.position().world()).isEqualTo("map2"));
    assertThat(homes).filteredOn(home -> home.archive().equals("town")).hasSize(5);
  }

  @Test
  void rejectsWorldMismatchesAndDuplicateRecords() {
    var row = "00000000-0000-0000-0000-00000000000a,2016,world,1,70,2\n";
    assertThatThrownBy(() -> HistoricalHomeCatalog.read(new BufferedReader(new StringReader(row))))
        .isInstanceOf(IllegalArgumentException.class);
    var valid = row.replace("2016,world", "2016,map2");
    assertThatThrownBy(
            () -> HistoricalHomeCatalog.read(new BufferedReader(new StringReader(valid + valid))))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
