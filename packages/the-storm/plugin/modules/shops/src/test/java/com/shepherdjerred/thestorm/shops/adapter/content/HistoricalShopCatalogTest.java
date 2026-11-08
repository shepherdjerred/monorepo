package com.shepherdjerred.thestorm.shops.adapter.content;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.BufferedReader;
import java.io.StringReader;
import org.junit.jupiter.api.Test;

final class HistoricalShopCatalogTest {
  private static final String ROW =
      "id,world,1,2,3,1,1,3,00000000-0000-0000-0000-000000000001,Alice,diamond,1,20,16,Diamond";

  private static BufferedReader input(String text) {
    return new BufferedReader(new StringReader(text));
  }

  @Test
  void catalogContainsTheVerifiedOriginalSignAndContainer() {
    var entries = HistoricalShopCatalog.load();
    assertThat(entries)
        .extracting(HistoricalShopCatalog.Entry::id)
        .contains("2015-pigrider-iron", "2015-pigrider-hay");
    assertThat(entries.getFirst().expectedLines())
        .containsExactly("[Buy]", "6", "Iron Ingot", "18");
    assertThat(entries.stream().filter(entry -> entry.id().equals("2015-eternal-dark-oak")))
        .singleElement()
        .satisfies(
            entry -> {
              assertThat(entry.expectedLines())
                  .containsExactly("[Buy]", "Dark Oak Logs", "2 Stacks for", "100cr");
              assertThat(entry.quantity()).isEqualTo(128);
              assertThat(entry.stockTarget()).isEqualTo(512);
            });
    assertThat(entries.stream().filter(entry -> entry.id().equals("2015-pikachupals-note-block")))
        .singleElement()
        .satisfies(
            entry -> {
              assertThat(entry.expectedLines()).containsExactly("[Buy]", "One Note", "Block", "20");
              assertThat(entry.stockTarget()).isEqualTo(16);
            });
    assertThat(
            entries.stream().filter(entry -> entry.id().equals("2015-pikachupals-leaping-potion")))
        .singleElement()
        .satisfies(
            entry -> {
              assertThat(entry.expectedLines())
                  .containsExactly("[Buy]", "Potion of", "Leaping", "20");
              assertThat(entry.stockTarget()).isEqualTo(4);
            });
    assertThat(entries.stream().filter(entry -> entry.id().equals("2015-pigrider-unbreaking-pick")))
        .singleElement()
        .satisfies(
            entry -> {
              assertThat(entry.expectedLines())
                  .containsExactly("[Buy]", "1", "Unbr. 1 Dia Pick", "100");
              assertThat(entry.stockTarget()).isEqualTo(8);
            });
    assertThat(entries.stream().filter(entry -> entry.id().equals("2015-pigrider-haste")))
        .singleElement()
        .satisfies(
            entry -> {
              assertThat(entry.expectedLines())
                  .containsExactly("[Buy]", "1", "Haste Potion Ext.", "15");
              assertThat(entry.stockTarget()).isEqualTo(16);
            });
    assertThat(entries.stream().filter(entry -> entry.id().equals("2015-smaland-bones-128")))
        .singleElement()
        .satisfies(
            entry -> {
              assertThat(entry.expectedLines()).containsExactly("[Buy]", "128 Bones", "", "$45");
              assertThat(entry.quantity()).isEqualTo(128);
            });
    assertThat(entries.stream().filter(entry -> entry.id().equals("2015-smaland-pearl")))
        .singleElement()
        .satisfies(
            entry -> {
              assertThat(entry.expectedLines()).containsExactly("[Buy]", "Enderpearl", "", "$25");
              assertThat(entry.stockTarget()).isEqualTo(24);
            });
    assertThat(entries.stream().filter(entry -> entry.id().equals("2016-detern-cobble")))
        .singleElement()
        .satisfies(
            entry -> {
              assertThat(entry.expectedLines())
                  .containsExactly("[Buy]", "32 Cobblestone", "for", "15");
              assertThat(entry.quantity()).isEqualTo(32);
              assertThat(entry.stockTarget()).isEqualTo(1024);
            });
    assertThat(entries.stream().filter(entry -> entry.id().equals("2016-dockozel-diamond")))
        .singleElement()
        .satisfies(
            entry -> {
              assertThat(entry.expectedLines()).containsExactly("[Buy]", "1 Diamond", "", "125");
              assertThat(entry.stockTarget()).isEqualTo(24);
              assertThat(entry.container().y()).isEqualTo(63);
            });
    assertThat(
            entries.stream().filter(entry -> entry.id().equals("2016-dockozel-prismarine-bricks")))
        .singleElement()
        .satisfies(
            entry ->
                assertThat(entry.expectedLines())
                    .containsExactly("[Buy]", "16 Prismarine", "Bricks", "25"));
  }

  @Test
  void valuableBudgetCoversAllOfAnOwnersListingsForThatItem() throws Exception {
    var second =
        ROW.replace("id,", "other,").replace("1,2,3,", "2,2,3,").replace("1,1,3,", "2,1,3,");
    assertThat(HistoricalShopCatalog.read(input(ROW + "\n" + second))).hasSize(2);
    var third =
        ROW.replace("id,", "third,").replace("1,2,3,", "3,2,3,").replace("1,1,3,", "3,1,3,");
    assertThatThrownBy(() -> HistoricalShopCatalog.read(input(ROW + "\n" + second + "\n" + third)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("budget");
  }

  @Test
  void multiplePricesForTheSamePhysicalStockDoNotMultiplyTheStockBudget() throws Exception {
    var second = ROW.replace("id,", "other,").replace("1,2,3,", "2,2,3,");
    var third = ROW.replace("id,", "third,").replace("1,2,3,", "3,2,3,");
    assertThat(HistoricalShopCatalog.read(input(ROW + "\n" + second + "\n" + third))).hasSize(3);
  }

  @Test
  void recoveredShopsRetainTheExactOriginalTextAndFiniteCustody() {
    var restored =
        HistoricalShopCatalog.load().stream().filter(e -> e.details().rewrite()).toList();
    assertThat(restored).hasSize(482);
    assertThat(restored).allSatisfy(e -> assertThat(e.details().originalLines()).hasSize(4));
    assertThat(restored.stream().filter(e -> e.item().equals("diamond")))
        .allSatisfy(e -> assertThat(e.stockTarget()).isBetween(16, 32));
    assertThat(restored.stream().filter(e -> e.details().sourceSlot() >= 0)).hasSize(25);
  }

  @Test
  void coloredLegacyOffersRetainTheirQuantityAndEquivalentFractionalPrice() {
    var entries = HistoricalShopCatalog.load();
    assertThat(entries.stream().filter(e -> e.id().equals("2015-recovered-2132-64--3572")))
        .singleElement()
        .satisfies(
            entry -> {
              assertThat(entry.expectedLines()).containsExactly("[Buy]", "64 Carrots", "for", "10");
              assertThat(entry.quantity()).isEqualTo(64);
              assertThat(entry.price()).isEqualTo(10);
            });
    assertThat(entries.stream().filter(e -> e.id().equals("2015-recovered-2151-81--3466")))
        .singleElement()
        .satisfies(
            entry -> {
              assertThat(entry.expectedLines()).containsExactly("[Sell]", "8 Wool", "for", ".5");
              assertThat(entry.quantity()).isEqualTo(16);
              assertThat(entry.price()).isEqualTo(1);
            });
  }

  @Test
  void duplicateSignsAndOversizedUnknownItemsAreRejected() {
    assertThatThrownBy(
            () -> HistoricalShopCatalog.read(input(ROW + "\n" + ROW.replace("id,", "other,"))))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("duplicate");
    assertThatThrownBy(
            () -> HistoricalShopCatalog.read(input(ROW.replace(",16,Diamond", ",64,Diamond"))))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("budget");
  }
}
