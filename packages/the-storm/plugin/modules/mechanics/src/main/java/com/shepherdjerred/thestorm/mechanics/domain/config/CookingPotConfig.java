package com.shepherdjerred.thestorm.mechanics.domain.config;

import com.shepherdjerred.thestorm.mechanics.domain.grid.Cell;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Cooking pots: a {@code [Cook]} sign over a fire that cooks what players put in.
 *
 * @param access who may build and use them
 * @param heatSources blocks that heat a pot when one sits one or two blocks below the sign;
 *     campfires must also be lit
 * @param fuels fuel items and how many items each one cooks
 * @param maxFuel the most fuel a pot holds
 */
public record CookingPotConfig(
    Access access, List<String> heatSources, Map<String, Integer> fuels, int maxFuel) {

  public static final int MAX_FUEL = 10_000;

  public CookingPotConfig {
    heatSources = List.copyOf(Checks.materials("heatSources", heatSources));
    if (fuels.isEmpty()) {
      throw new IllegalArgumentException("fuels must list at least one item");
    }
    fuels.forEach(
        (item, units) -> {
          Cell.requireMaterialKey(item);
          Checks.range("fuels." + item, units, 1, MAX_FUEL);
        });
    fuels = Map.copyOf(fuels);
    Checks.range("maxFuel", maxFuel, 1, MAX_FUEL);
  }

  public Set<String> heat() {
    return Set.copyOf(heatSources);
  }
}
