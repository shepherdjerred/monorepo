package com.shepherdjerred.thestorm.mechanics.domain.tools;

import com.shepherdjerred.thestorm.mechanics.domain.config.CookingPotConfig;
import com.shepherdjerred.thestorm.mechanics.domain.grid.BlockGrid;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Direction;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import java.util.Optional;
import java.util.stream.Stream;

/**
 * Cooking pots: a {@code [Cook]} sign with a fire one or two blocks below it. Fuel is added by
 * right-clicking the sign with a fuel item; each unit of fuel cooks one item.
 */
public final class CookingPot {

  private CookingPot() {}

  /** The heat source under the sign at {@code sign}, if there is one. */
  public static Optional<Pos> heatSource(BlockGrid grid, Pos sign, CookingPotConfig config) {
    var heat = config.heat();
    return Stream.of(sign.offset(Direction.DOWN), sign.offset(Direction.DOWN, 2))
        .filter(grid::contains)
        .filter(pos -> heat.contains(grid.cellAt(pos).material()))
        .findFirst();
  }

  /**
   * Adding fuel items.
   *
   * @param itemsTaken how many of the offered items the pot takes
   * @param fuel the pot's fuel afterwards
   */
  public record Refuel(int itemsTaken, int fuel) {}

  /**
   * Offers {@code items} fuel items worth {@code unitsEach} to a pot holding {@code fuel}. The pot
   * takes whole items only, as many as fit under {@code maxFuel}.
   */
  public static Refuel refuel(int fuel, Offer offer, int maxFuel) {
    var room = Math.max(0, maxFuel - fuel);
    var taken = Math.min(offer.items(), room / offer.unitsEach());
    return new Refuel(taken, fuel + taken * offer.unitsEach());
  }

  /**
   * Items offered to a pot.
   *
   * @param items how many
   * @param unitsEach the fuel each is worth, or 1 for food (one unit cooks one)
   */
  public record Offer(int items, int unitsEach) {

    public Offer {
      if (items < 0 || unitsEach < 1) {
        throw new IllegalArgumentException("bad offer: " + items + " x " + unitsEach);
      }
    }
  }

  /**
   * Cooking.
   *
   * @param cooked how many items are cooked
   * @param fuel the pot's fuel afterwards
   */
  public record Cook(int cooked, int fuel) {}

  /** Cooks up to {@code items} with {@code fuel}: one unit each, as many as the fuel covers. */
  public static Cook cook(int fuel, int items) {
    var cooked = Math.min(items, fuel);
    return new Cook(cooked, fuel - cooked);
  }
}
