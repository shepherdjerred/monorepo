package com.shepherdjerred.thestorm.shops.domain.sign;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.shops.domain.price.Price;
import com.shepherdjerred.thestorm.shops.domain.price.PriceProblem;
import com.shepherdjerred.thestorm.shops.domain.price.ShopPrices;
import com.shepherdjerred.thestorm.shops.domain.trade.Direction;
import java.util.List;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

final class PriceLineTest {

  @ParameterizedTest
  @CsvSource(
      delimiter = '|',
      value = {
        "B 50:S 40|50|40",
        "b50:s40|50|40",
        "S 40:B 50|50|40",
        "50B:40S|50|40",
        "50 b : 40 s|50|40",
        "  B 50 : S 40  |50|40",
        "B 1,000:S 999|1000|999",
        "B 1000000000|1000000000|0",
        "S 7|0|7",
        "B 7|7|0",
        "B 5:S 5|5|5",
      })
  void readsEveryAcceptedSpelling(String line, long buy, long sell) {
    var expected =
        new ShopPrices(
            buy == 0 ? java.util.Optional.empty() : java.util.Optional.of(Price.of(buy)),
            sell == 0 ? java.util.Optional.empty() : java.util.Optional.of(Price.of(sell)));

    assertThat(PriceLine.parse(line)).isEqualTo(Result.ok(expected));
  }

  @ParameterizedTest
  @ValueSource(strings = {"", "   "})
  void anEmptyLineHasNoPrices(String line) {
    assertThat(PriceLine.parse(line))
        .isEqualTo(Result.err(List.of(new SignProblem.MissingPrices())));
  }

  @ParameterizedTest
  @ValueSource(
      strings = {"50", "B", "B five", "X 50", "B -5", "B 5.5", "B 1,00", "B 5 S 4", "Buy 5", ""})
  void rejectsPartsThatAreNotPrices(String part) {
    var line = part.isEmpty() ? "B 5:" : part;

    assertThat(PriceLine.parse(line))
        .isEqualTo(Result.err(List.of(new SignProblem.NotAPrice(part))));
  }

  @ParameterizedTest
  @ValueSource(strings = {"B 0", "B 000"})
  void rejectsZero(String line) {
    assertThat(PriceLine.parse(line))
        .isEqualTo(Result.err(List.of(new SignProblem.ZeroPrice(Direction.BUY))));
  }

  @ParameterizedTest
  @ValueSource(strings = {"S 1000000001", "S 99999999999999999999999"})
  void rejectsPricesAboveTheMaximum(String line) {
    assertThat(PriceLine.parse(line))
        .isEqualTo(Result.err(List.of(new SignProblem.PriceTooHigh(Direction.SELL, Price.MAX))));
  }

  @ParameterizedTest
  @ValueSource(strings = {"B 5:B 6", "5b:6B"})
  void rejectsTheSameSideTwice(String line) {
    assertThat(PriceLine.parse(line))
        .isEqualTo(Result.err(List.of(new SignProblem.SideTwice(Direction.BUY))));
  }

  @ParameterizedTest
  @ValueSource(strings = {"B 5:S 4:S 3", "::"})
  void rejectsMoreThanTwoParts(String line) {
    assertThat(PriceLine.parse(line))
        .isEqualTo(Result.err(List.of(new SignProblem.TooManyPrices(3))));
  }

  @org.junit.jupiter.api.Test
  void rejectsSellingAboveTheBuyPrice() {
    assertThat(PriceLine.parse("B 40:S 50"))
        .isEqualTo(
            Result.err(List.of(new SignProblem.BadPrices(new PriceProblem.SellAboveBuy(40, 50)))));
  }

  @org.junit.jupiter.api.Test
  void reportsEveryBadPart() {
    assertThat(PriceLine.parse("B 0:S x"))
        .isEqualTo(
            Result.err(
                List.of(
                    new SignProblem.ZeroPrice(Direction.BUY), new SignProblem.NotAPrice("S x"))));
  }

  @ParameterizedTest
  @ValueSource(strings = {"B 50:S 40", "b5", "5 s", "S1,000", "Admin 5 b"})
  void spotsPriceLines(String line) {
    assertThat(PriceLine.looksLikePrices(line)).isTrue();
  }

  @ParameterizedTest
  @ValueSource(strings = {"", "Welcome home", "Floor 2", "Bob's house", "50", "Sb"})
  void leavesOrdinaryTextAlone(String line) {
    assertThat(PriceLine.looksLikePrices(line)).isFalse();
  }
}
