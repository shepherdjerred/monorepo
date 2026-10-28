package com.shepherdjerred.thestorm.core.protection;

import org.bukkit.Location;

/**
 * Containers a shop already claims. Other modules ask before using a container as their own stock,
 * because a shop's inventory is only moved by trades. Shops publishes this; it is absent when that
 * module is not enabled.
 */
public interface ReservedContainers {

  /** Whether a shop claims the container at {@code location}, either half of a double chest. */
  boolean contains(Location location);
}
