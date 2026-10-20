package com.shepherdjerred.thestorm.creative.domain;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Which plots a map may label. Only the creative world's map, and only claimed or staff-held plots.
 */
public final class PlotMarkers {

  private PlotMarkers() {}

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
   * Id, owner, name, and description, in that order. A staff-held plot's owner reads {@code staff}.
   */
  public static String label(PlotView view) {
    var owner = view.staffHeld() ? "staff" : view.owner().map(UUID::toString).orElse("staff");
    return view.id().text() + " " + owner + " " + view.name() + " " + view.description();
  }
}
