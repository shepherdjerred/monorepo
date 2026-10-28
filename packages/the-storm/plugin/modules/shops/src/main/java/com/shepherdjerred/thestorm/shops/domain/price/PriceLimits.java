package com.shepherdjerred.thestorm.shops.domain.price;

import com.shepherdjerred.thestorm.shops.domain.trade.Direction;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/**
 * The cheapest and dearest a shop sign may ask, globally and for named materials. A material entry
 * replaces the global band for that material only.
 *
 * @param minBuy the least a customer may be charged
 * @param maxBuy the most a customer may be charged
 * @param minSell the least a customer may be paid
 * @param maxSell the most a customer may be paid
 * @param materials per-material bands, keyed by the material name in any case
 */
public record PriceLimits(
    long minBuy, long maxBuy, long minSell, long maxSell, Map<String, Band> materials) {

  /**
   * One material's price band.
   *
   * @param minBuy the least a customer may be charged
   * @param maxBuy the most a customer may be charged
   * @param minSell the least a customer may be paid
   * @param maxSell the most a customer may be paid
   */
  public record Band(long minBuy, long maxBuy, long minSell, long maxSell) {
    public Band {
      check("minBuy", minBuy, maxBuy);
      check("minSell", minSell, maxSell);
    }
  }

  /** Why a price is outside the band that applies to it. */
  public record Violation(Direction side, long price, long min, long max) {}

  public PriceLimits {
    check("minBuy", minBuy, maxBuy);
    check("minSell", minSell, maxSell);
    var keyed = new java.util.HashMap<String, Band>();
    materials.forEach(
        (name, band) -> {
          if (!name.matches("[A-Za-z0-9_]+")) {
            throw new IllegalArgumentException(
                "material limits are names like DIAMOND, not " + name);
          }
          keyed.put(name.toUpperCase(Locale.ROOT), band);
        });
    materials = Map.copyOf(keyed);
  }

  /** The band {@code price} breaks for {@code side}, using {@code material} when it has its own. */
  public Optional<Violation> check(Direction side, long price, String material) {
    var band = materials.get(material.toUpperCase(Locale.ROOT));
    var min =
        band == null
            ? (side == Direction.BUY ? minBuy : minSell)
            : (side == Direction.BUY ? band.minBuy() : band.minSell());
    var max =
        band == null
            ? (side == Direction.BUY ? maxBuy : maxSell)
            : (side == Direction.BUY ? band.maxBuy() : band.maxSell());
    if (price < min || price > max) {
      return Optional.of(new Violation(side, price, min, max));
    }
    return Optional.empty();
  }

  private static void check(String name, long min, long max) {
    if (min < 1 || max > Price.MAX || min > max) {
      throw new IllegalArgumentException(
          name + " band must be 1.." + Price.MAX + " and ordered: " + min + ".." + max);
    }
  }
}
