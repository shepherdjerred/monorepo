package com.shepherdjerred.thestorm.creative.domain;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/** Who holds a plot. Empty owner means nobody may build there except staff. */
public interface PlotMembership {

  /** The player who may build here, when one has been proven or has claimed it. */
  Optional<UUID> owner(PlotId id);

  /** Members, trusted players, and denied players. The recovered signs recorded none. */
  Map<UUID, PlotRole> access(PlotId id);

  /** Visitor flags that are on. Empty means every flag is off. */
  Set<PlotFlag> flags(PlotId id);

  /** A claimed or staff-held plot. An empty cell is not marked. */
  boolean marked(PlotId id);

  /**
   * Plots merged with {@code id}, including {@code id}. A plot that stands alone is just itself.
   * The default is a lone plot, for a catalog that has no merge rows.
   */
  default List<PlotId> merged(PlotId id) {
    return List.of(id);
  }

  /** Every merge of two or more plots. Empty when nothing is merged. */
  default List<List<PlotId>> clusters() {
    return List.of();
  }
}
