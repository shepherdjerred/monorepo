package com.shepherdjerred.thestorm.mechanics.domain.config;

import java.util.List;
import java.util.Set;

/**
 * A gate: fence columns near a {@code [Gate]} sign that drop down to close and pull up to open.
 *
 * @param access who may build and use it
 * @param blocks the column materials (fences, iron bars, panes)
 * @param searchRadius how far from the sign, in every direction, columns are looked for
 * @param maxColumns the most columns one sign moves
 * @param maxHeight the most blocks a column extends below its top
 */
public record GateConfig(
    Access access, List<String> blocks, int searchRadius, int maxColumns, int maxHeight) {

  public static final int MAX_SEARCH_RADIUS = 8;
  public static final int MAX_COLUMNS = 64;
  public static final int MAX_HEIGHT = 32;

  public GateConfig {
    blocks = List.copyOf(Checks.materials("blocks", blocks));
    Checks.range("searchRadius", searchRadius, 1, MAX_SEARCH_RADIUS);
    Checks.range("maxColumns", maxColumns, 1, MAX_COLUMNS);
    Checks.range("maxHeight", maxHeight, 1, MAX_HEIGHT);
  }

  public Set<String> allowed() {
    return Set.copyOf(blocks);
  }
}
