package com.shepherdjerred.thestorm.creative.domain;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Which plots a map may label. Only the creative world's map, and only claimed or staff-held plots.
 */
public final class PlotMarkers {

  private PlotMarkers() {}

  /** Only playable, fully contained plots are shown by the live creative map. */
  public static List<PlotMarker> select(
      String mapWorld, CreativeConfig config, List<PlotView> views) {
    var playable =
        views.stream()
            .filter(
                view ->
                    ClaimRules.inside(
                        config.grid().bounds(view.id()),
                        config.borderCenterX(),
                        config.borderCenterZ(),
                        config.borderSize()))
            .toList();
    return select(mapWorld, config.world(), playable, config.grid());
  }

  public static List<PlotMarker> select(
      String mapWorld, String creativeWorld, List<PlotView> views, PlotGrid grid) {
    if (!creativeWorld.equals(mapWorld)) {
      return List.of();
    }
    var markers = new ArrayList<PlotMarker>();
    for (var view : views) {
      if (!view.marked()) {
        continue;
      }
      var bounds = grid.bounds(view.id());
      markers.add(
          new PlotMarker(
              view.id(), label(view), bounds.minX(), bounds.maxX(), bounds.minZ(), bounds.maxZ()));
    }
    return List.copyOf(markers);
  }

  /**
   * Views whose blank name is filled with {@code usernames}. A plot that already has a name is
   * unchanged, so the map shows that name instead of the owner.
   */
  public static List<PlotView> presented(List<PlotView> views, Map<PlotId, String> usernames) {
    var presented = new ArrayList<PlotView>();
    for (var view : views) {
      var username = usernames.get(view.id());
      if (!view.name().isBlank() || username == null || username.isBlank()) {
        presented.add(view);
      } else {
        presented.add(view.withName(username));
      }
    }
    return List.copyOf(presented);
  }

  /** Usernames written on recovered claim signs, keyed by plot. */
  public static Map<PlotId, String> signedNames(Collection<RecoveredPlot> plots) {
    var names = new LinkedHashMap<PlotId, String>();
    for (var plot : plots) {
      plot.signedOwner().ifPresent(name -> names.put(plot.plotId(), name));
    }
    return Map.copyOf(names);
  }

  /**
   * The username to show when a plot has no name of its own. A name from {@code known} (the player
   * directory, or someone online now) replaces the claim-sign name.
   */
  public static Map<PlotId, String> usernames(
      List<PlotView> views, Map<PlotId, String> signed, Map<UUID, String> known) {
    var names = new LinkedHashMap<PlotId, String>();
    for (var view : views) {
      if (!view.name().isBlank()) {
        continue;
      }
      var current =
          view.owner()
              .flatMap(id -> Optional.ofNullable(known.get(id)))
              .filter(name -> !name.isBlank());
      if (current.isPresent()) {
        names.put(view.id(), current.orElseThrow());
        continue;
      }
      var historical = signed.get(view.id());
      if (historical != null && !historical.isBlank()) {
        names.put(view.id(), historical);
      }
    }
    return Map.copyOf(names);
  }

  /**
   * The plot's name when one is set. Otherwise {@code staff}. Callers put the owner's username in
   * the name first, through {@link #presented}.
   */
  public static String label(PlotView view) {
    if (!view.name().isBlank()) {
      return view.name();
    }
    return "staff";
  }
}
