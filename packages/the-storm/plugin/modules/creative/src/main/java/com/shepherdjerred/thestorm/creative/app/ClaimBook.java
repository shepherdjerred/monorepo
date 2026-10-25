package com.shepherdjerred.thestorm.creative.app;

import com.shepherdjerred.thestorm.creative.domain.PlotCatalog;
import com.shepherdjerred.thestorm.creative.domain.PlotFlag;
import com.shepherdjerred.thestorm.creative.domain.PlotId;
import com.shepherdjerred.thestorm.creative.domain.PlotMembership;
import com.shepherdjerred.thestorm.creative.domain.PlotRole;
import com.shepherdjerred.thestorm.creative.domain.PlotView;
import com.shepherdjerred.thestorm.creative.domain.PlotViews;
import com.shepherdjerred.thestorm.creative.domain.StoredClaim;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
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

  /** Plots that share {@code id}'s anchor, including {@code id}. A lone plot is just itself. */
  @Override
  public List<PlotId> merged(PlotId id) {
    var row = stored.get(id);
    if (row == null || row.cluster().isEmpty()) {
      return List.of(id);
    }
    var anchor = row.cluster().orElseThrow();
    var members = new ArrayList<PlotId>();
    for (var claim : stored.values()) {
      if (anchor.equals(claim.cluster().orElse(null))) {
        members.add(claim.id());
      }
    }
    if (members.isEmpty()) {
      return List.of(id);
    }
    return List.copyOf(members);
  }

  /** Stored rows in {@code id}'s merge, when they have been saved. */
  public List<StoredClaim> cluster(PlotId id) {
    var rows = new ArrayList<StoredClaim>();
    for (var member : merged(id)) {
      var row = stored.get(member);
      if (row != null) {
        rows.add(row);
      }
    }
    return List.copyOf(rows);
  }

  /** Every anchor that has at least two plots. */
  @Override
  public List<List<PlotId>> clusters() {
    var grouped = new LinkedHashMap<PlotId, List<PlotId>>();
    for (var claim : stored.values()) {
      if (claim.cluster().isEmpty()) {
        continue;
      }
      grouped
          .computeIfAbsent(claim.cluster().orElseThrow(), ignored -> new ArrayList<>())
          .add(claim.id());
    }
    var result = new ArrayList<List<PlotId>>();
    for (var members : grouped.values()) {
      if (members.size() >= 2) {
        result.add(List.copyOf(members));
      }
    }
    return List.copyOf(result);
  }

  @Override
  public Optional<UUID> owner(PlotId id) {
    return view(id).owner();
  }

  @Override
  public Map<UUID, PlotRole> access(PlotId id) {
    return view(id).access();
  }

  @Override
  public Set<PlotFlag> flags(PlotId id) {
    return view(id).flags();
  }

  @Override
  public boolean marked(PlotId id) {
    return view(id).marked();
  }
}
