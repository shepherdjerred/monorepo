package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import org.bukkit.Location;
import org.bukkit.entity.Entity;

/** Location helpers. */
final class Places {

  private Places() {}

  /**
   * Where {@code entity} is. Takes an {@link Entity} so a player resolves to the entity's non-null
   * location rather than {@code OfflinePlayer}'s nullable one.
   */
  static Location at(Entity entity) {
    return entity.getLocation();
  }
}
