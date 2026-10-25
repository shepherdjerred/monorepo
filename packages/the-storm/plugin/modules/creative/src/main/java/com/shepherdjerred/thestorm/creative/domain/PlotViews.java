package com.shepherdjerred.thestorm.creative.domain;

import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Merges the historical catalog with one stored row. The catalog file is never an input to write.
 */
public final class PlotViews {

  private PlotViews() {}

  public static PlotView resolve(
      PlotId id, Optional<RecoveredPlot> catalog, Optional<StoredClaim> stored) {
    var catalogOwner = catalog.flatMap(RecoveredPlot::ownerId);
    var staffHeld = catalog.isPresent() && catalog.orElseThrow().owner().isBlank();
    if (stored.isEmpty()) {
      return new PlotView(id, catalogOwner, "", "", Map.of(), staffHeld, false, Set.of());
    }
    var row = stored.orElseThrow();
    if (row.released()) {
      return new PlotView(
          id, Optional.empty(), row.name(), row.description(), Map.of(), false, false, Set.of());
    }
    if (row.owner().isPresent()) {
      return new PlotView(
          id,
          row.owner(),
          row.name(),
          row.description(),
          row.access(),
          false,
          row.countsTowardCap(),
          row.flags());
    }
    return new PlotView(
        id,
        catalogOwner,
        row.name(),
        row.description(),
        row.access(),
        staffHeld,
        false,
        row.flags());
  }
}
