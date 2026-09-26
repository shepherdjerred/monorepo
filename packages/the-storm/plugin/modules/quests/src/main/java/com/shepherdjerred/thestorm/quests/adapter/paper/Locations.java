package com.shepherdjerred.thestorm.quests.adapter.paper;

import java.util.Objects;
import org.bukkit.Location;
import org.bukkit.entity.Entity;
import org.bukkit.inventory.ItemStack;
import org.jspecify.annotations.Nullable;

/** Null-checked access to Paper values its annotations leave nullable. */
final class Locations {

  private Locations() {}

  /** Where {@code entity} is; a live entity always has a location. */
  static Location of(Entity entity) {
    return Objects.requireNonNull(entity.getLocation(), "entity has no location");
  }

  /** Inventory slots; empty slots are null. */
  static @Nullable ItemStack[] slots(@Nullable ItemStack @Nullable [] contents) {
    return Objects.requireNonNull(contents, "inventory has no contents");
  }
}
