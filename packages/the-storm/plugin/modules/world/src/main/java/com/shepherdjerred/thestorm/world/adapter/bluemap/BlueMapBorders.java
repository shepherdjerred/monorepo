package com.shepherdjerred.thestorm.world.adapter.bluemap;

import com.flowpowered.math.vector.Vector2d;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.world.domain.BorderOutline;
import de.bluecolored.bluemap.api.BlueMapAPI;
import de.bluecolored.bluemap.api.markers.MarkerSet;
import de.bluecolored.bluemap.api.markers.ShapeMarker;
import de.bluecolored.bluemap.api.math.Color;
import de.bluecolored.bluemap.api.math.Shape;
import java.util.List;
import java.util.function.Consumer;
import org.bukkit.Server;
import org.jspecify.annotations.Nullable;

/**
 * A "World border" marker set on every map of each bordered world, drawn from world.yml. BlueMap
 * markers live only in memory, so the set is redrawn each time BlueMap starts, including after a
 * reload.
 */
public final class BlueMapBorders {

  private static final String SET_ID = "thestorm-border";
  private static final String SET_LABEL = "World border";
  private static final String MARKER_ID = "border";
  private static final float MARKER_Y = 64;
  private static final Color LINE = new Color(0xE0, 0x3C, 0x31, 1f);
  private static final Color FILL = new Color(0xE0, 0x3C, 0x31, 0f);

  private final Server server;
  private final List<BorderOutline> outlines;
  private @Nullable Consumer<BlueMapAPI> onEnable;

  public BlueMapBorders(Server server, List<BorderOutline> outlines) {
    this.server = server;
    this.outlines = List.copyOf(outlines);
  }

  public void start(Scheduler scheduler) {
    Consumer<BlueMapAPI> listener = api -> scheduler.runOnMainThread(() -> draw(api));
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

  private void draw(BlueMapAPI api) {
    for (var outline : outlines) {
      var world = server.getWorld(outline.world());
      if (world == null) {
        // WorldPaper refuses to start without every bordered world, so this is a world unloaded
        // since.
        continue;
      }
      api.getWorld(world)
          .ifPresent(
              blue -> {
                for (var map : blue.getMaps()) {
                  var set =
                      map.getMarkerSets()
                          .computeIfAbsent(
                              SET_ID,
                              id -> MarkerSet.builder().label(SET_LABEL).toggleable(true).build());
                  set.put(MARKER_ID, marker(outline));
                }
              });
    }
  }

  private static ShapeMarker marker(BorderOutline outline) {
    var shape =
        new Shape(
            outline.points().stream().map(point -> new Vector2d(point.x(), point.z())).toList());
    return ShapeMarker.builder()
        .label(SET_LABEL)
        .shape(shape, MARKER_Y)
        .depthTestEnabled(false)
        .lineColor(LINE)
        .fillColor(FILL)
        .lineWidth(3)
        .build();
  }
}
