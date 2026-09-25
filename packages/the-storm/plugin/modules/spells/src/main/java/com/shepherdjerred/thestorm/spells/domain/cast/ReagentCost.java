package com.shepherdjerred.thestorm.spells.domain.cast;

import java.util.Map;
import java.util.TreeMap;

/**
 * The reagents one cast consumes, by material name (for example {@code REDSTONE}).
 *
 * @param amounts how many of each material; every amount is positive
 */
public record ReagentCost(Map<String, Integer> amounts) {

  /** The most of one reagent a cast may cost: a full inventory of stacks. */
  public static final int MAX_AMOUNT = 36 * 64;

  public ReagentCost {
    validate(amounts);
    amounts = Map.copyOf(amounts);
  }

  /** Throws unless every material is named and every amount is 1 to {@link #MAX_AMOUNT}. */
  public static void validate(Map<String, Integer> amounts) {
    for (var entry : amounts.entrySet()) {
      if (entry.getKey().isBlank()) {
        throw new IllegalArgumentException("a reagent needs a material name");
      }
      if (entry.getValue() < 1 || entry.getValue() > MAX_AMOUNT) {
        throw new IllegalArgumentException(
            "reagent " + entry.getKey() + " must cost 1.." + MAX_AMOUNT + ": " + entry.getValue());
      }
    }
  }

  /** A cost of nothing. */
  public static ReagentCost free() {
    return new ReagentCost(Map.of());
  }

  /**
   * What {@code held} lacks to pay this cost: each short material mapped to how many more are
   * needed. Empty when the cost can be paid. Materials the cost does not name are ignored.
   */
  public Map<String, Integer> shortfall(Map<String, Integer> held) {
    var missing = new TreeMap<String, Integer>();
    amounts.forEach(
        (material, amount) -> {
          var have = held.getOrDefault(material, 0);
          if (have < amount) {
            missing.put(material, amount - have);
          }
        });
    return missing;
  }

  /** True when {@code held} covers the whole cost. */
  public boolean affordableWith(Map<String, Integer> held) {
    return shortfall(held).isEmpty();
  }
}
