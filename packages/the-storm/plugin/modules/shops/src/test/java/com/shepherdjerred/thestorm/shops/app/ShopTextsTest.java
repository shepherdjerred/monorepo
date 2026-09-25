package com.shepherdjerred.thestorm.shops.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.economy.app.CrystalFormatter;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.shops.domain.catalog.CatalogEntry;
import com.shepherdjerred.thestorm.shops.domain.trade.Direction;
import com.shepherdjerred.thestorm.shops.domain.trade.OwnerSummary;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeProblem;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeRecord;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeSite;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.OptionalInt;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class ShopTextsTest {

  private static final CrystalFormatter FORMAT =
      new CrystalFormatter() {
        @Override
        public String words(Crystals amount) {
          return amount.amount() + (amount.amount() == 1 ? " crystal" : " crystals");
        }

        @Override
        public String symbol(Crystals amount) {
          return amount.amount() + " CR";
        }
      };

  private final ShopTexts texts = new ShopTexts(FORMAT);

  private static TradeRecord trade(Direction direction) {
    return new TradeRecord(
        new TradeSite.Chest(1, new UUID(0, 1)),
        new UUID(0, 2),
        "Bob",
        direction,
        "coal",
        16,
        48,
        Instant.EPOCH);
  }

  @Test
  void receiptsNameTheGoodsThePriceAndTheShop() {
    assertThat(texts.completed(Direction.BUY, ShopTexts.goods(16, "coal"), 48, "Alice's shop"))
        .isEqualTo("You bought 16 Coal from Alice's shop for 48 crystals.");
    assertThat(texts.completed(Direction.SELL, ShopTexts.goods(1, "emerald"), 1, "Braxton"))
        .isEqualTo("You sold 1 Emerald to Braxton for 1 crystal.");
  }

  @Test
  void ownersHearWhoTradedWhat() {
    assertThat(texts.ownerNotice(trade(Direction.BUY)))
        .isEqualTo("Bob bought 16 Coal from your shop for 48 crystals.");
    assertThat(texts.ownerNotice(trade(Direction.SELL)))
        .isEqualTo("Bob sold you 16 Coal at your shop for 48 crystals.");
  }

  @Test
  void theSummarySaysWhatHappenedWhileAway() {
    var summary =
        OwnerSummary.of(
            List.of(trade(Direction.BUY), trade(Direction.BUY), trade(Direction.SELL)), 1);

    assertThat(texts.summary(summary))
        .containsExactly(
            "While you were away, your shops made 3 trades: earned 96 crystals, spent 48"
                + " crystals.",
            "Sold 32 Coal for 96 crystals.",
            "...and 1 more.");
  }

  @Test
  void everyProblemHasASentence() {
    var problems =
        List.<TradeProblem>of(
            new TradeProblem.NotOffered(Direction.BUY),
            new TradeProblem.NotOffered(Direction.SELL),
            new TradeProblem.ItemNotSet(),
            new TradeProblem.OwnShop(),
            new TradeProblem.Busy(),
            new TradeProblem.OutOfStock(3, 16),
            new TradeProblem.NoRoom(3, 16),
            new TradeProblem.NotEnoughItems(3, 16),
            new TradeProblem.ShopFull(3, 16),
            new TradeProblem.CustomerCannotPay(3, 16),
            new TradeProblem.OwnerCannotPay(),
            new TradeProblem.DailyLimitReached(0, 16),
            new TradeProblem.DailyLimitReached(4, 16));

    assertThat(problems)
        .allSatisfy(problem -> assertThat(texts.problem(problem, "Coal")).isNotBlank());
    assertThat(texts.problem(new TradeProblem.CustomerCannotPay(3, 16), "Coal"))
        .isEqualTo("Not enough crystals: that costs 16 crystals and you have 3 crystals.");
    assertThat(texts.problem(new TradeProblem.OutOfStock(3, 16), "Coal"))
        .isEqualTo("Out of stock: the shop has 3 Coal and a trade needs 16.");
    assertThat(texts.refunded(new TradeProblem.OutOfStock(0, 16), "Coal"))
        .endsWith("Your crystals were returned.");
    assertThat(texts.refundFailed(new TradeProblem.OutOfStock(0, 16), "Coal"))
        .contains("staff have been told");
  }

  @Test
  void catalogEntriesShowTheirPrices() {
    var entry =
        new CatalogEntry("coal", 16, Optional.of(48L), Optional.of(16L), OptionalInt.empty());

    assertThat(ShopTexts.entryLabel(entry)).isEqualTo("16 Coal");
    assertThat(texts.entryPrices(entry)).isEqualTo("Buy 48 CR · Sell 16 CR");
    assertThat(texts.symbol(5)).isEqualTo("5 CR");
  }
}
