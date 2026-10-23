package com.shepherdjerred.thestorm.creative.app;

import com.shepherdjerred.thestorm.creative.domain.PlotCatalog;
import com.shepherdjerred.thestorm.creative.domain.PlotId;
import com.shepherdjerred.thestorm.creative.domain.PlotMembership;
import com.shepherdjerred.thestorm.creative.domain.PlotRole;
import com.shepherdjerred.thestorm.creative.domain.PlotView;
import com.shepherdjerred.thestorm.creative.domain.PlotViews;
import com.shepherdjerred.thestorm.creative.domain.StoredClaim;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * The catalog plus the latest stored rows. Protection and WorldEdit read this on the main thread. A
 * store callback replaces the snapshot there. Until {@link #replace} runs, only the catalog is
 * visible and {@link #ready} is false.
 */
public final class ClaimBook implements PlotMembership {

  private final PlotCatalog catalog;
  private volatile Map<PlotId, StoredClaim> stored = Map.of();
  private volatile boolean ready;

  public ClaimBook(PlotCatalog catalog) {
    this.catalog = catalog;
  }

  public boolean ready() {
    return ready;
  }

  public PlotCatalog catalog() {
    return catalog;
  }

  public void replace(Collection<StoredClaim> rows) {
    var next = new HashMap<PlotId, StoredClaim>();
    for (var row : rows) {
      next.put(row.id(), row);
    }
    stored = Map.copyOf(next);
    ready = true;
  }

  public void put(StoredClaim claim) {
    var next = new HashMap<>(stored);
    next.put(claim.id(), claim);
    stored = Map.copyOf(next);
  }

  public void remove(PlotId id) {
    var next = new HashMap<>(stored);
    next.remove(id);
    stored = Map.copyOf(next);
  }

  public PlotView view(PlotId id) {
    return PlotViews.resolve(id, catalog.get(id), Optional.ofNullable(stored.get(id)));
  }

  /** The stored row, when one has been saved. Absent for a catalog-only plot. */
  public Optional<StoredClaim> row(PlotId id) {
    return Optional.ofNullable(stored.get(id));
  }

  public Collection<StoredClaim> stored() {
    return stored.values();
  }

  /** Claimed and staff-held plots. Empty cells are absent. */
  public List<PlotView> marked() {
    var ids = new LinkedHashSet<PlotId>();
    for (var plot : catalog.plots()) {
      ids.add(plot.plotId());
    }
    ids.addAll(stored.keySet());
    var views = new ArrayList<PlotView>();
    for (var id : ids) {
      var view = view(id);
      if (view.marked()) {
        views.add(view);
      }
    }
    return List.copyOf(views);
  }

  /** Every view that can count, including restored plots the counter then ignores. */
  public List<PlotView> visible() {
    var ids = new LinkedHashSet<PlotId>();
    for (var plot : catalog.plots()) {
      ids.add(plot.plotId());
    }
    ids.addAll(stored.keySet());
    var views = new ArrayList<PlotView>();
    for (var id : ids) {
      views.add(view(id));
    }
    return List.copyOf(views);
  }

  @Override
  public Optional<UUID> owner(PlotId id) {
    return view(id).owner();
  }

  @Override
  public Map<UUID, PlotRole> access(PlotId id) {
    return view(id).access();
  }
}
