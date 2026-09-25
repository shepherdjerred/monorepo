package com.shepherdjerred.thestorm.shops.domain.sign;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.shops.domain.price.PriceProblem;
import com.shepherdjerred.thestorm.shops.domain.price.ShopPrices;
import com.shepherdjerred.thestorm.shops.domain.trade.Direction;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

final class ShopSignParserTest {

  private final ShopSignParser parser = new ShopSignParser(576, "Admin Shop");

  @Test
  void readsAPlayersShop() {
    var result = parser.parse(SignLines.of("", "16", "B 50:S 40", "coal"));

    assertThat(result)
        .isEqualTo(
            Result.ok(
                new ShopSignDraft(
                    new OwnerLine.Creator(),
                    16,
                    ShopPrices.both(50, 40),
                    new ItemLine.Named("coal"))));
  }

  @Test
  void theOwnerLineIsIgnoredForPlayerShops() {
    var result = parser.parse(SignLines.of("SomeoneElse", "1", "B 5", "Diamond Sword"));

    assertThat(result.map(ShopSignDraft::owner)).isEqualTo(Result.ok(new OwnerLine.Creator()));
  }

  @ParameterizedTest
  @ValueSource(strings = {"Admin Shop", "admin shop", "  ADMIN SHOP  "})
  void theAdminLabelMakesAnAdminShop(String owner) {
    var result = parser.parse(SignLines.of(owner, "1", "S 5", "emerald"));

    assertThat(result.map(ShopSignDraft::owner)).isEqualTo(Result.ok(new OwnerLine.AdminShop()));
  }

  @Test
  void aQuestionMarkLeavesTheItemToBeSet() {
    var result = parser.parse(SignLines.of("", "1", "B 500", " ? "));

    assertThat(result.map(ShopSignDraft::item)).isEqualTo(Result.ok(new ItemLine.Pending()));
  }

  @Test
  void reportsEveryProblemAtOnce() {
    var result = parser.parse(SignLines.of("", "lots", "B 40:S 50", ""));

    assertThat(result)
        .isEqualTo(
            Result.err(
                List.of(
                    new SignProblem.NotAQuantity("lots"),
                    new SignProblem.BadPrices(new PriceProblem.SellAboveBuy(40, 50)),
                    new SignProblem.MissingItem())));
  }

  @Test
  void reportsAMissingQuantityAndPrices() {
    var result = parser.parse(SignLines.of("", " ", "", "coal"));

    assertThat(result)
        .isEqualTo(
            Result.err(
                List.of(new SignProblem.MissingQuantity(), new SignProblem.MissingPrices())));
  }

  @ParameterizedTest
  @ValueSource(strings = {"0", "577", "9999999999", "00"})
  void quantitiesOutsideTheRangeAreRefused(String quantity) {
    assertThat(QuantityLine.parse(quantity, 576))
        .isEqualTo(Result.err(new SignProblem.QuantityOutOfRange(quantity, 576)));
  }

  @ParameterizedTest
  @ValueSource(strings = {"-1", "1.5", "16x", "x16", "1 6", "sixteen"})
  void quantitiesMustBeWholeNumbers(String quantity) {
    assertThat(QuantityLine.parse(quantity, 576))
        .isEqualTo(Result.err(new SignProblem.NotAQuantity(quantity)));
  }

  @ParameterizedTest
  @ValueSource(strings = {"1", "64", "576", " 16 ", "016"})
  void acceptsQuantitiesInRange(String quantity) {
    assertThat(QuantityLine.parse(quantity, 576).isOk()).isTrue();
  }

  @Test
  void spotsSignsMeantToBeShops() {
    assertThat(parser.looksLikeShop(SignLines.of("", "16", "B 50", "coal"))).isTrue();
    assertThat(parser.looksLikeShop(SignLines.of("", "x", "S 5", ""))).isTrue();
    assertThat(parser.looksLikeShop(SignLines.of("Admin Shop", "1", "free", "coal"))).isTrue();
  }

  @Test
  void leavesOrdinarySignsAlone() {
    assertThat(parser.looksLikeShop(SignLines.of("Welcome", "to", "Aegis", ""))).isFalse();
    assertThat(parser.looksLikeShop(SignLines.of("", "", "B 5", "coal"))).isFalse();
    assertThat(parser.looksLikeShop(SignLines.of("Home", "Floor 2", "", ""))).isFalse();
  }

  @Test
  void theParserNeedsSaneSettings() {
    assertThatThrownBy(() -> new ShopSignParser(0, "Admin Shop"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new ShopSignParser(1, " "))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void signLinesHaveExactlyFourLines() {
    assertThatThrownBy(() -> new SignLines(List.of("a", "b", "c")))
        .isInstanceOf(IllegalArgumentException.class);
    var lines = SignLines.of("a", "b", "c", "d");
    assertThat(List.of(lines.owner(), lines.quantity(), lines.prices(), lines.item()))
        .containsExactly("a", "b", "c", "d");
  }

  @Test
  void everyProblemDescribesItself() {
    var problems =
        List.<SignProblem>of(
            new SignProblem.MissingQuantity(),
            new SignProblem.NotAQuantity("x"),
            new SignProblem.QuantityOutOfRange("0", 64),
            new SignProblem.MissingPrices(),
            new SignProblem.NotAPrice("x"),
            new SignProblem.ZeroPrice(Direction.BUY),
            new SignProblem.PriceTooHigh(Direction.SELL, 9),
            new SignProblem.SideTwice(Direction.SELL),
            new SignProblem.TooManyPrices(3),
            new SignProblem.BadPrices(new PriceProblem.NothingOffered()),
            new SignProblem.MissingItem(),
            new SignProblem.UnknownItem("blorp"));

    assertThat(problems).allSatisfy(problem -> assertThat(problem.describe()).isNotBlank());
    assertThat(new SignProblem.SideTwice(Direction.SELL).describe())
        .isEqualTo("Line 3 has two sell prices.");
    assertThat(new SignProblem.ZeroPrice(Direction.BUY).describe())
        .isEqualTo("The buy price must be at least 1 crystal.");
    assertThat(new SignProblem.BadPrices(new PriceProblem.SellAboveBuy(1, 2)).describe())
        .isEqualTo("The sell price (2) must not be above the buy price (1).");
  }

  @Test
  void namedItemsMustNotBeBlank() {
    assertThatThrownBy(() -> new ItemLine.Named(" ")).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void draftsNeedAPositiveQuantity() {
    assertThatThrownBy(
            () ->
                new ShopSignDraft(
                    new OwnerLine.Creator(), 0, ShopPrices.buyOnly(1), new ItemLine.Pending()))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
