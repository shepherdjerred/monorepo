package com.shepherdjerred.thestorm.world.domain;

import java.time.LocalDate;
import java.util.List;

/** Authored item barters rotate by local date, with bounded costs and finite daily stock. */
public final class MerchantStock {

  private MerchantStock() {}

  public enum Item {
    BREAD,
    TORCH,
    LANTERN
  }

  public record Offer(Item item, int resultCount, int costCount, int maxUses) {}

  public static List<Offer> forDate(LocalDate date) {
    var day = date.toEpochDay();
    var first = Math.floorMod(day, 3);
    return List.of(offer(Item.values()[first], day), offer(Item.values()[(first + 1) % 3], day));
  }

  private static Offer offer(Item item, long day) {
    return switch (item) {
      case BREAD -> new Offer(item, 2, 14 + Math.floorMod(day, 5), 8);
      case TORCH -> new Offer(item, 8, 4 + Math.floorMod(day, 3), 8);
      case LANTERN -> new Offer(item, 1, 7 + Math.floorMod(day, 3), 4);
    };
  }
}
