package com.shepherdjerred.thestorm.spells.adapter.paper;

import com.shepherdjerred.thestorm.spells.app.SpellStore;
import com.shepherdjerred.thestorm.spells.domain.Waypoint;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.NamespacedKey;
import org.bukkit.Server;

/** Players' Marks: held in memory, written through to storage. Main thread only. */
public final class Waypoints {

  private final Map<UUID, Waypoint> marks = new HashMap<>();
  private final SpellStore store;
  private final Async async;

  Waypoints(SpellStore store, Async async) {
    this.store = store;
    this.async = async;
  }

  void restore(Map<UUID, Waypoint> stored) {
    marks.putAll(stored);
  }

  public Optional<Waypoint> of(UUID player) {
    return Optional.ofNullable(marks.get(player));
  }

  /** Sets {@code player}'s Mark to {@code location}. */
  public void mark(UUID player, Location location) {
    var world = location.getWorld();
    var waypoint =
        new Waypoint(
            world.getKey().asString(),
            location.getX(),
            location.getY(),
            location.getZ(),
            location.getYaw(),
            location.getPitch());
    marks.put(player, waypoint);
    async.logFailure(store.saveMark(player, waypoint), "storing the Mark of " + player);
  }

  /** Where {@code waypoint} is now, or empty if its world is not loaded. */
  public static Optional<Location> locate(Server server, Waypoint waypoint) {
    var key = NamespacedKey.fromString(waypoint.world());
    var world = key == null ? null : server.getWorld(key);
    if (world == null) {
      return Optional.empty();
    }
    return Optional.of(
        new Location(
            world, waypoint.x(), waypoint.y(), waypoint.z(), waypoint.yaw(), waypoint.pitch()));
  }
}
