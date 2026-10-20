package com.shepherdjerred.thestorm.creative.domain;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Recovered plots keyed by id. Empty cells are absent; they are claimable. */
public final class PlotCatalog {

  private final Map<PlotId, RecoveredPlot> byId;

  private PlotCatalog(Map<PlotId, RecoveredPlot> byId) {
    this.byId = byId;
  }

  /** Rejects a repeated id. Insertion order is the file order. */
  public static PlotCatalog of(List<RecoveredPlot> plots) {
    var byId = new LinkedHashMap<PlotId, RecoveredPlot>();
    for (var plot : plots) {
      if (byId.put(plot.plotId(), plot) != null) {
        throw new IllegalArgumentException("duplicate creative plot: " + plot.id());
      }
    }
    return new PlotCatalog(Map.copyOf(byId));
  }

  public Optional<RecoveredPlot> get(PlotId id) {
    return Optional.ofNullable(byId.get(id));
  }

  public int size() {
    return byId.size();
  }

  /** Every recovered plot. Empty cells are not here. */
  public Collection<RecoveredPlot> plots() {
    return byId.values();
  }
}
