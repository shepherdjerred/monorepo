package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import java.util.Optional;
import org.bukkit.Location;
import org.bukkit.Server;
import org.bukkit.entity.Entity;

/** Converts between Paper locations and domain positions. */
final class Positions {

  private Positions() {}

  /** The position of {@code location}, which must be in a loaded world. */
  static Position of(Location location) {
    return new Position(
        location.getWorld().getName(),
        location.getX(),
        location.getY(),
        location.getZ(),
        location.getYaw(),
        location.getPitch());
  }

  /**
   * Where {@code entity} is. Takes an {@link Entity} so a {@code Player} resolves to the entity's
   * non-null location rather than {@code OfflinePlayer}'s nullable one.
   */
  static Location current(Entity entity) {
    return entity.getLocation();
  }

  /** The position of {@code entity}. */
  static Position of(Entity entity) {
    return of(current(entity));
  }

  /** The location of {@code position}, or empty if its world is not loaded. */
  static Optional<Location> toLocation(Server server, Position position) {
    return Optional.ofNullable(server.getWorld(position.world()))
        .map(
            world ->
                new Location(
                    world,
                    position.x(),
                    position.y(),
                    position.z(),
                    position.yaw(),
                    position.pitch()));
  }
}
