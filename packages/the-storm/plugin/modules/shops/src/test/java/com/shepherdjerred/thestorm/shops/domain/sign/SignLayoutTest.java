package com.shepherdjerred.thestorm.shops.domain.sign;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.shops.domain.price.ShopPrices;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

final class SignLayoutTest {

  @Test
  void rendersTheCanonicalFormat() {
    assertThat(SignLayout.render("Alice", 16, ShopPrices.both(50, 40), "Coal"))
        .isEqualTo(SignLines.of("Alice", "16", "B 50:S 40", "Coal"));
    assertThat(SignLayout.priceLine(ShopPrices.buyOnly(7))).isEqualTo("B 7");
    assertThat(SignLayout.priceLine(ShopPrices.sellOnly(7))).isEqualTo("S 7");
  }

  @Test
  void renderedPricesParseBackToTheSamePrices() {
    var prices = ShopPrices.both(1_000_000, 999_999);

    assertThat(PriceLine.parse(SignLayout.priceLine(prices))).isEqualTo(Result.ok(prices));
  }

  @ParameterizedTest
  @CsvSource({
    "COAL,Coal",
    "diamond_sword,Diamond Sword",
    "minecraft:oak_log,Oak Log",
    "WAXED_WEATHERED_COPPER_CHEST,Waxed Weathered Copper Chest",
    "tnt,Tnt"
  })
  void prettyNamesComeFromKeys(String key, String expected) {
    assertThat(ItemNames.pretty(key)).isEqualTo(expected);
  }

  @Test
  void signLabelsFitTheSign() {
    assertThat(ItemNames.signLabel("coal", false)).isEqualTo("Coal");
    assertThat(ItemNames.signLabel("diamond_sword", true)).isEqualTo("Diamond Sword*");
    assertThat(ItemNames.signLabel("waxed_weathered_copper_chest", false))
        .isEqualTo("Waxed Weathered")
        .hasSizeLessThanOrEqualTo(ItemNames.SIGN_WIDTH);
    assertThat(ItemNames.signLabel("waxed_weathered_copper_chest", true))
        .isEqualTo("Waxed Weathere*")
        .hasSize(ItemNames.SIGN_WIDTH);
  }
}
