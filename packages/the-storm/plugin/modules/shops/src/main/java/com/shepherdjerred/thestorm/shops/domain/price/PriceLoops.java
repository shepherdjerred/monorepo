package com.shepherdjerred.thestorm.shops.domain.price;

import java.util.List;
import java.util.Optional;

/**
 * Finds buy-sell loops between server offers (admin signs and NPC catalogs): an offer that pays
 * more per item than another charges, or charges less per item than another pays. Per-item prices
 * are compared exactly by cross-multiplying, so trade sizes may differ.
 */
public final class PriceLoops {

  /**
   * One server offer for an item.
   *
   * @param item what is traded: a plain item's key, or a unique id for a particular variant
   * @param quantity items per trade
   * @param prices what one trade costs and pays
   * @param source who offers it, for messages, such as "Reynold's Supplies"
   */
  public record Offer(String item, int quantity, ShopPrices prices, String source) {
    public Offer {
      if (quantity < 1) {
        throw new IllegalArgumentException("quantity must be positive: " + quantity);
      }
    }
  }

  private PriceLoops() {}

  /** The first existing offer {@code candidate} would form a loop with, if any. */
  public static Optional<Offer> conflict(Offer candidate, List<Offer> existing) {
    return existing.stream()
        .filter(other -> other.item().equals(candidate.item()))
        .filter(other -> paysMore(candidate, other) || paysMore(other, candidate))
        .findFirst();
  }

  /** {@code payer} pays more per item (its sell price) than {@code charger} charges (its buy). */
  private static boolean paysMore(Offer payer, Offer charger) {
    var paid = payer.prices().sell();
    var charged = charger.prices().buy();
    if (paid.isEmpty() || charged.isEmpty()) {
      return false;
    }
    return Math.multiplyExact(paid.orElseThrow().crystals(), (long) charger.quantity())
        > Math.multiplyExact(charged.orElseThrow().crystals(), (long) payer.quantity());
  }
}
