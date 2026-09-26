package com.shepherdjerred.thestorm.shops.domain.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.shops.domain.trade.Direction;
import java.nio.file.Path;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class ShopsConfigTest {

  static final Path SHIPPED = Path.of("../../../server/owned/plugins/TheStorm/shops.yml");

  private static final Map<Integer, Integer> LIMITS = Map.of(1, 5, 2, 10, 3, 20, 4, 35, 5, 50);

  private static ChestShopSettings settings(
      ChestShopSettings.Click click, int maxQuantity, List<String> containers) {
    return new ChestShopSettings(click, maxQuantity, "Admin Shop", containers, LIMITS, 5, 250);
  }

  @Test
  void theShippedConfigParses() {
    var config = ConfigFiles.load(SHIPPED, ShopsConfig.class);

    assertThat(config.chestShops().buyClick()).isEqualTo(ChestShopSettings.Click.RIGHT);
    assertThat(config.chestShops().containers()).contains("CHEST", "BARREL", "COPPER_CHEST");
    assertThat(config.chestShops().containers()).doesNotContain("SHULKER_BOX");
    assertThat(config.chestShops().limits().allowed(1)).isEqualTo(5);
    assertThat(config.chestShops().clickCooldown()).isEqualTo(java.time.Duration.ofMillis(150));
    assertThat(config.catalogs().zone()).isEqualTo(ZoneId.of("America/Los_Angeles"));
    assertThat(config.catalogs().maxDistance()).isEqualTo(8);
  }

  @Test
  void theConfiguredClickBuysAndTheOtherSells() {
    var rightBuys = settings(ChestShopSettings.Click.RIGHT, 64, List.of("CHEST"));
    var leftBuys = settings(ChestShopSettings.Click.LEFT, 64, List.of("CHEST"));

    assertThat(rightBuys.directionOf(ChestShopSettings.Click.RIGHT)).isEqualTo(Direction.BUY);
    assertThat(rightBuys.directionOf(ChestShopSettings.Click.LEFT)).isEqualTo(Direction.SELL);
    assertThat(leftBuys.directionOf(ChestShopSettings.Click.LEFT)).isEqualTo(Direction.BUY);
  }

  @Test
  void settingsValidateThemselves() {
    assertThatThrownBy(() -> settings(ChestShopSettings.Click.RIGHT, 0, List.of("CHEST")))
        .hasMessageContaining("maxQuantity");
    assertThatThrownBy(() -> settings(ChestShopSettings.Click.RIGHT, 1, List.of()))
        .hasMessageContaining("containers");
    assertThatThrownBy(() -> settings(ChestShopSettings.Click.RIGHT, 1, List.of("chest")))
        .hasMessageContaining("material names");
    assertThatThrownBy(() -> settings(ChestShopSettings.Click.RIGHT, 1, List.of("CHEST", "CHEST")))
        .hasMessageContaining("twice");
    assertThatThrownBy(
            () ->
                new ChestShopSettings(
                    ChestShopSettings.Click.RIGHT, 1, " ", List.of("CHEST"), LIMITS, 5, 250))
        .hasMessageContaining("adminShopLabel");
    assertThatThrownBy(
            () ->
                new ChestShopSettings(
                    ChestShopSettings.Click.RIGHT, 1, "A", List.of("CHEST"), Map.of(1, 1), 5, 250))
        .hasMessageContaining("level 2");
    assertThatThrownBy(
            () ->
                new ChestShopSettings(
                    ChestShopSettings.Click.RIGHT, 1, "A", List.of("CHEST"), LIMITS, 0, 250))
        .hasMessageContaining("summaryLines");
    assertThatThrownBy(
            () ->
                new ChestShopSettings(
                    ChestShopSettings.Click.RIGHT, 1, "A", List.of("CHEST"), LIMITS, 5, -1))
        .hasMessageContaining("clickCooldownMillis");
  }

  @Test
  void catalogSettingsValidateThemselves() {
    assertThatThrownBy(() -> new CatalogSettings("Mars/Olympus", 16, 8))
        .hasMessageContaining("time zone");
    assertThatThrownBy(() -> new CatalogSettings("UTC", 0, 8)).hasMessageContaining("maxLots");
    assertThatThrownBy(() -> new CatalogSettings("UTC", 1, 0)).hasMessageContaining("maxDistance");
    assertThat(new CatalogSettings("America/Los_Angeles", 1, 8).zone())
        .isEqualTo(ZoneId.of("America/Los_Angeles"));
  }
}
