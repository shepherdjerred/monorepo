package com.shepherdjerred.thestorm.shops.domain.trade;

import static java.util.Comparator.comparingLong;

import java.util.LinkedHashMap;
import java.util.List;

/**
 * What happened at a player's chest shops while they were away, grouped by item and direction.
 *
 * @param trades how many trades there were
 * @param earned crystals customers paid the owner
 * @param spent crystals the owner paid customers
 * @param lines the largest groups, most crystals first
 * @param more how many smaller groups were left out
 */
public record OwnerSummary(int trades, long earned, long spent, List<Line> lines, int more) {

  /**
   * One item traded in one direction.
   *
   * @param direction {@link Direction#BUY}: customers bought from the owner
   * @param material the item's material key
   * @param quantity items in total
   * @param crystals crystals in total
   */
  public record Line(Direction direction, String material, int quantity, long crystals) {}

  public OwnerSummary {
    lines = List.copyOf(lines);
  }

  public boolean isEmpty() {
    return trades == 0;
  }

  /** Summarizes {@code trades}, keeping at most {@code maxLines} lines. */
  public static OwnerSummary of(List<TradeRecord> trades, int maxLines) {
    if (maxLines < 1) {
      throw new IllegalArgumentException("maxLines must be positive: " + maxLines);
    }
    record Key(Direction direction, String material) {}
    var groups = new LinkedHashMap<Key, Line>();
    var earned = 0L;
    var spent = 0L;
    for (var trade : trades) {
      var key = new Key(trade.direction(), trade.material());
      groups.merge(
          key,
          new Line(trade.direction(), trade.material(), trade.quantity(), trade.price()),
          (a, b) ->
              new Line(
                  a.direction(),
                  a.material(),
                  Math.addExact(a.quantity(), b.quantity()),
                  Math.addExact(a.crystals(), b.crystals())));
      switch (trade.direction()) {
        case BUY -> earned = Math.addExact(earned, trade.price());
        case SELL -> spent = Math.addExact(spent, trade.price());
      }
    }
    var sorted =
        groups.values().stream()
            .sorted(
                comparingLong(Line::crystals)
                    .reversed()
                    .thenComparing(Line::direction)
                    .thenComparing(Line::material))
            .toList();
    var shown = sorted.subList(0, Math.min(maxLines, sorted.size()));
    return new OwnerSummary(trades.size(), earned, spent, shown, sorted.size() - shown.size());
  }
}
