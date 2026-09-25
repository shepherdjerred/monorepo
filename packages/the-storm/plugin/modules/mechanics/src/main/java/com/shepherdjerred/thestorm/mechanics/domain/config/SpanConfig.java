package com.shepherdjerred.thestorm.mechanics.domain.config;

import java.util.List;
import java.util.Set;

/**
 * A bridge or door: a line of blocks between two signs, stored in the signs while open.
 *
 * @param access who may build and use it
 * @param blocks the materials it may be built from
 * @param maxLength the most blocks between the two ends
 * @param maxWidthEachSide how many blocks it may extend to each side of its centre line
 */
public record SpanConfig(Access access, List<String> blocks, int maxLength, int maxWidthEachSide) {

  /** The longest span the server allows, to bound searches. */
  public static final int MAX_LENGTH = 64;

  /** The widest a span may be on each side of its centre line. */
  public static final int MAX_WIDTH_EACH_SIDE = 4;

  public SpanConfig {
    blocks = List.copyOf(Checks.materials("blocks", blocks));
    Checks.range("maxLength", maxLength, 1, MAX_LENGTH);
    Checks.range("maxWidthEachSide", maxWidthEachSide, 0, MAX_WIDTH_EACH_SIDE);
  }

  public Set<String> allowed() {
    return Set.copyOf(blocks);
  }
}
