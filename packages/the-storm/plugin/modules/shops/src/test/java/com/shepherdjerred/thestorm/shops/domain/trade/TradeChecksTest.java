package com.shepherdjerred.thestorm.shops.domain.trade;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

final class TradeChecksTest {

  @Test
  void buyingNeedsStockThenRoom() {
    assertThat(TradeChecks.goods(Direction.BUY, 16, new Stockpile(0, 100), new Stockpile(16, 0)))
        .isEmpty();
    assertThat(TradeChecks.goods(Direction.BUY, 16, new Stockpile(0, 100), new Stockpile(15, 0)))
        .contains(new TradeProblem.OutOfStock(15, 16));
    assertThat(TradeChecks.goods(Direction.BUY, 16, new Stockpile(0, 15), new Stockpile(99, 0)))
        .contains(new TradeProblem.NoRoom(15, 16));
  }

  @Test
  void outOfStockIsReportedBeforeNoRoom() {
    assertThat(TradeChecks.goods(Direction.BUY, 16, new Stockpile(0, 0), new Stockpile(0, 0)))
        .contains(new TradeProblem.OutOfStock(0, 16));
  }

  @Test
  void sellingNeedsItemsThenShopRoom() {
    assertThat(TradeChecks.goods(Direction.SELL, 8, new Stockpile(8, 0), new Stockpile(0, 8)))
        .isEmpty();
    assertThat(TradeChecks.goods(Direction.SELL, 8, new Stockpile(7, 0), new Stockpile(0, 0)))
        .contains(new TradeProblem.NotEnoughItems(7, 8));
    assertThat(TradeChecks.goods(Direction.SELL, 8, new Stockpile(9, 0), new Stockpile(0, 7)))
        .contains(new TradeProblem.ShopFull(7, 8));
  }

  @Test
  void unlimitedShopsNeverRunOut() {
    assertThat(TradeChecks.goods(Direction.BUY, 2304, new Stockpile(0, 2304), Stockpile.UNLIMITED))
        .isEmpty();
    assertThat(TradeChecks.goods(Direction.SELL, 2304, new Stockpile(2304, 0), Stockpile.UNLIMITED))
        .isEmpty();
  }

  @Test
  void quantitiesArePositive() {
    assertThatThrownBy(
            () -> TradeChecks.goods(Direction.BUY, 0, Stockpile.UNLIMITED, Stockpile.UNLIMITED))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Stockpile(-1, 0)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void directionsHaveStableIds() {
    assertThat(Direction.BUY.id()).isEqualTo("buy");
    assertThat(Direction.fromId("sell")).isEqualTo(Direction.SELL);
  }
}
