package com.shepherdjerred.thestorm.mechanics.domain.config;

import java.util.List;
import java.util.Set;

/**
 * Blocks that drop themselves when a Mechanic breaks them by hand (glass, panes, bookshelves).
 *
 * @param unlock who benefits
 * @param blocks the materials that drop themselves
 */
public record BlockDropsConfig(Unlock unlock, List<String> blocks) {

  public BlockDropsConfig {
    blocks = List.copyOf(Checks.materials("blocks", blocks));
  }

  public Set<String> allowed() {
    return Set.copyOf(blocks);
  }
}
