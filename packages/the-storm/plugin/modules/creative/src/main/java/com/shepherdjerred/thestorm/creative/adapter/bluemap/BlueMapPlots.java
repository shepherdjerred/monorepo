package com.shepherdjerred.thestorm.creative.adapter.bluemap;

import com.flowpowered.math.vector.Vector2d;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.creative.domain.PlotMarker;
import de.bluecolored.bluemap.api.BlueMapAPI;
import de.bluecolored.bluemap.api.BlueMapMap;
import de.bluecolored.bluemap.api.markers.HtmlMarker;
import de.bluecolored.bluemap.api.markers.MarkerSet;
import de.bluecolored.bluemap.api.markers.ShapeMarker;
import de.bluecolored.bluemap.api.math.Color;
import de.bluecolored.bluemap.api.math.Shape;
import java.util.List;
import java.util.function.Consumer;
import org.bukkit.World;
import org.jspecify.annotations.Nullable;

/**
 * A "Plots" marker set on the creative world's maps only. Survival maps are never asked for this
 * set. Empty cells are not passed in.
 */
public final class BlueMapPlots {

  private static final String SET_ID = "thestorm-plots";
  private static final String SET_LABEL = "Plots";
  private static final float MARKER_Y = 64;
  private static final Color LINE = new Color(0x4D, 0xCC, 0xC4, 1f);
  private static final Color FILL = new Color(0x4D, 0xCC, 0xC4, 0.25f);

  /**
   * Camera distance, in blocks, at which a name has faded out. It stays fully visible closer than
   * half of this, so a neighborhood still reads and the whole-map view does not.
   */
  private static final double NAME_MAX_DISTANCE = 4_000;

  private final World world;
  private @Nullable Consumer<BlueMapAPI> onEnable;

  public BlueMapPlots(World world) {
    this.world = world;
  }

  /** Redraws on the main thread each time BlueMap starts, including after a reload. */
  public void start(Scheduler scheduler, Runnable redraw) {
    Consumer<BlueMapAPI> listener = api -> scheduler.runOnMainThread(redraw);
    onEnable = listener;
    BlueMapAPI.onEnable(listener);
  }

  public void stop() {
    var listener = onEnable;
    if (listener != null) {
      BlueMapAPI.unregisterListener(listener);
      onEnable = null;
    }
  }

  public void draw(List<PlotMarker> markers) {
    BlueMapAPI.getInstance().ifPresent(api -> draw(api, markers));
  }

  private void draw(BlueMapAPI api, List<PlotMarker> markers) {
    api.getWorld(world)
        .ifPresent(
            blue -> {
              for (var map : blue.getMaps()) {
                replace(map, markers);
              }
            });
  }

  private static void replace(BlueMapMap map, List<PlotMarker> markers) {
    var set = markers(map);
    set.getMarkers().clear();
    for (var marker : markers) {
      var id = marker.id().x() + "_" + marker.id().z();
      set.put(id, shape(marker));
      set.put(id + "-name", name(marker));
    }
  }

  private static MarkerSet markers(BlueMapMap map) {
    return map.getMarkerSets()
        .computeIfAbsent(
            SET_ID, id -> MarkerSet.builder().label(SET_LABEL).toggleable(true).build());
  }

  private static ShapeMarker shape(PlotMarker marker) {
    var east = marker.maxX() + 1.0;
    var south = marker.maxZ() + 1.0;
    var outline =
        new Shape(
            List.of(
                new Vector2d(marker.minX(), marker.minZ()),
                new Vector2d(east, marker.minZ()),
                new Vector2d(east, south),
                new Vector2d(marker.minX(), south)));
    return ShapeMarker.builder()
        .label(marker.label())
        .shape(outline, MARKER_Y)
        .depthTestEnabled(false)
        .lineColor(LINE)
        .fillColor(FILL)
        .lineWidth(2)
        .build();
  }

  /** The name on the map itself. Unlisted, so the plot outline remains the one sidebar entry. */
  private static HtmlMarker name(PlotMarker marker) {
    var x = (marker.minX() + marker.maxX() + 1) / 2.0;
    var z = (marker.minZ() + marker.maxZ() + 1) / 2.0;
    return HtmlMarker.builder()
        .label(marker.label())
        .position(x, MARKER_Y, z)
        .html(PlotNameHtml.of(marker.label()))
        .anchor(0, 0)
        .listed(false)
        .minDistance(0)
        .maxDistance(NAME_MAX_DISTANCE)
        .build();
  }
}
