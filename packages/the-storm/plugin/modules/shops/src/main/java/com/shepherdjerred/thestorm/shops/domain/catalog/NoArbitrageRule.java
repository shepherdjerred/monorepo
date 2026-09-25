package com.shepherdjerred.thestorm.shops.domain.catalog;

import java.util.ArrayList;
import java.util.List;

/**
 * No catalog pays more per item than any catalog charges for it. Within one entry the sell price is
 * already at most the buy price; this extends the rule across catalogs and trade sizes, comparing
 * per-item prices exactly by cross-multiplying.
 */
public final class NoArbitrageRule implements CatalogRule {

  private record Offer(String catalog, String item, long price, int quantity) {}

  @Override
  public List<CatalogProblem> check(List<CatalogFile> files) {
    var sells = new ArrayList<Offer>();
    var buys = new ArrayList<Offer>();
    for (var file : files) {
      var id = file.catalog().id();
      for (var entry : file.catalog().entries()) {
        entry
            .sell()
            .ifPresent(price -> sells.add(new Offer(id, entry.itemKey(), price, entry.quantity())));
        entry
            .buy()
            .ifPresent(price -> buys.add(new Offer(id, entry.itemKey(), price, entry.quantity())));
      }
    }
    var problems = new ArrayList<CatalogProblem>();
    for (var paid : sells) {
      for (var charged : buys) {
        if (paid.item().equals(charged.item()) && paysMorePerItem(paid, charged)) {
          problems.add(
              new CatalogProblem.Arbitrage(paid.item(), paid.catalog(), charged.catalog()));
        }
      }
    }
    return List.copyOf(problems);
  }

  /** paid.price / paid.quantity > charged.price / charged.quantity, without division. */
  private static boolean paysMorePerItem(Offer paid, Offer charged) {
    return Math.multiplyExact(paid.price(), (long) charged.quantity())
        > Math.multiplyExact(charged.price(), (long) paid.quantity());
  }
}
