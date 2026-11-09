package com.shepherdjerred.thestorm.skytravel.adapter.bluemap;

import com.flowpowered.math.vector.Vector3d;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.skytravel.domain.LaunchConfig;
import de.bluecolored.bluemap.api.BlueMapAPI;
import de.bluecolored.bluemap.api.markers.MarkerSet;
import de.bluecolored.bluemap.api.markers.POIMarker;
import java.util.function.Consumer;
import org.bukkit.World;
import org.jspecify.annotations.Nullable;

/** Completed pads and their accessible entrances only; replaces its own marker set on reload. */
public final class BlueMapTowers {
  private static final String ID = "thestorm-skylands-towers";
  private final World world;
  private final LaunchConfig config;
  private @Nullable Consumer<BlueMapAPI> listener;

  public BlueMapTowers(World world, LaunchConfig config) {
    this.world = world;
    this.config = config;
  }

  public void start(Scheduler scheduler) {
    Consumer<BlueMapAPI> enabled = api -> scheduler.runOnMainThread(() -> draw(api));
    listener = enabled;
    BlueMapAPI.onEnable(enabled);
  }

  private void draw(BlueMapAPI api) {
    api.getWorld(world)
        .ifPresent(blue -> {
          for (var map : blue.getMaps()) {
            var markers = MarkerSet.builder().label("Skylands beacons").toggleable(true).build();
            for (var tower : config.towers()) {
              if (!tower.commissioned()) continue;
              markers.put(tower.id(), marker("Beacon " + tower.id(), tower.pad()));
              for (var i = 0; i < tower.entrances().size(); i++) {
                markers.put(
                    tower.id() + "-entrance-" + i,
                    marker("Beacon " + tower.id() + " entrance", tower.entrances().get(i)));
              }
            }
            map.getMarkerSets().put(ID, markers);
          }
        });
  }

  private static POIMarker marker(String label, LaunchConfig.Block block) {
    return POIMarker.builder()
        .label(label)
        .position(new Vector3d(block.x() + 0.5, block.y(), block.z() + 0.5))
        .build();
  }

  public void stop() {
    var enabled = listener;
    if (enabled != null) BlueMapAPI.unregisterListener(enabled);
    BlueMapAPI.getInstance()
        .flatMap(api -> api.getWorld(world))
        .ifPresent(blue -> blue.getMaps().forEach(map -> map.getMarkerSets().remove(ID)));
    listener = null;
  }
}
