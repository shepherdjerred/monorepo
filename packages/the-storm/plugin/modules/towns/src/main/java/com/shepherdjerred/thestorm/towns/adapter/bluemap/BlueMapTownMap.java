package com.shepherdjerred.thestorm.towns.adapter.bluemap;

import com.flowpowered.math.vector.Vector2d;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.towns.app.TownMap;
import com.shepherdjerred.thestorm.towns.domain.map.Outline;
import de.bluecolored.bluemap.api.BlueMapAPI;
import de.bluecolored.bluemap.api.BlueMapMap;
import de.bluecolored.bluemap.api.markers.MarkerSet;
import de.bluecolored.bluemap.api.markers.ShapeMarker;
import de.bluecolored.bluemap.api.math.Color;
import de.bluecolored.bluemap.api.math.Shape;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Consumer;
import org.bukkit.Server;
import org.jspecify.annotations.Nullable;

/**
 * Towns on BlueMap: each town's land as area markers in a "Towns" marker set on every map of its
 * world. Only loaded when BlueMap is installed; BlueMap's types never leave this package. Called on
 * the main thread; BlueMap's marker sets may be changed from any thread.
 */
public final class BlueMapTownMap implements TownMap {

  private static final String SET_ID = "thestorm-towns";
  private static final String SET_LABEL = "Towns";

  /** Where the flat markers are drawn; BlueMap draws them over the terrain. */
  private static final float MARKER_Y = 64;

  /** The house teal (#4DCCC4): a solid border and a light fill. */
  private static final Color LINE = new Color(0x4D, 0xCC, 0xC4, 1f);

  private static final Color FILL = new Color(0x4D, 0xCC, 0xC4, 0.25f);

  private final Server server;
  private @Nullable Consumer<BlueMapAPI> onEnable;

  public BlueMapTownMap(Server server) {
    this.server = server;
  }

  /**
   * Starts listening for BlueMap: {@code redrawAll} runs on the main thread each time BlueMap
   * starts (and again after a reload, which drops every marker), to draw every town again.
   */
  public void start(Scheduler scheduler, Runnable redrawAll) {
    Consumer<BlueMapAPI> listener = api -> scheduler.runOnMainThread(redrawAll);
    onEnable = listener;
    BlueMapAPI.onEnable(listener);
  }

  /** Stops listening for BlueMap, for when the module stops. */
  public void stop() {
    var listener = onEnable;
    if (listener != null) {
      BlueMapAPI.unregisterListener(listener);
      onEnable = null;
    }
  }

  @Override
  public void draw(UUID townId, String name, Map<String, List<Outline>> outlines) {
    BlueMapAPI.getInstance()
        .ifPresent(
            api -> {
              erase(api, townId);
              var label = new Label(townId, name);
              outlines.forEach((worldName, pieces) -> drawWorld(api, label, worldName, pieces));
            });
  }

  /** A town as its markers name it. */
  private record Label(UUID townId, String name) {}

  private void drawWorld(BlueMapAPI api, Label label, String worldName, List<Outline> pieces) {
    var townId = label.townId();
    var name = label.name();
    var world = server.getWorld(worldName);
    if (world == null) {
      throw new IllegalStateException(
          "town " + name + " holds land in unloaded world " + worldName);
    }
    api.getWorld(world)
        .ifPresent(
            blueWorld -> {
              for (var map : blueWorld.getMaps()) {
                var set = markers(map);
                for (var i = 0; i < pieces.size(); i++) {
                  set.put(markerId(townId, i), marker(name, pieces.get(i)));
                }
              }
            });
  }

  @Override
  public void erase(UUID townId) {
    BlueMapAPI.getInstance().ifPresent(api -> erase(api, townId));
  }

  private static void erase(BlueMapAPI api, UUID townId) {
    var prefix = prefix(townId);
    for (var map : api.getMaps()) {
      var set = map.getMarkerSets().get(SET_ID);
      if (set != null) {
        set.getMarkers().keySet().removeIf(id -> id.startsWith(prefix));
      }
    }
  }

  @Override
  public void eraseAll() {
    BlueMapAPI.getInstance()
        .ifPresent(
            api -> {
              for (var map : api.getMaps()) {
                var set = map.getMarkerSets().get(SET_ID);
                if (set != null) {
                  set.getMarkers().clear();
                }
              }
            });
  }

  private static MarkerSet markers(BlueMapMap map) {
    return map.getMarkerSets()
        .computeIfAbsent(
            SET_ID, id -> MarkerSet.builder().label(SET_LABEL).toggleable(true).build());
  }

  private static ShapeMarker marker(String name, Outline outline) {
    var holes = outline.holes().stream().map(BlueMapTownMap::shape).toArray(Shape[]::new);
    return ShapeMarker.builder()
        .label(name)
        .shape(shape(outline.ring()), MARKER_Y)
        .holes(holes)
        .depthTestEnabled(false)
        .lineColor(LINE)
        .fillColor(FILL)
        .lineWidth(2)
        .build();
  }

  private static Shape shape(List<Outline.Corner> corners) {
    return new Shape(corners.stream().map(corner -> new Vector2d(corner.x(), corner.z())).toList());
  }

  private static String prefix(UUID townId) {
    return "town-" + townId + "-";
  }

  private static String markerId(UUID townId, int piece) {
    return prefix(townId) + piece;
  }
}
