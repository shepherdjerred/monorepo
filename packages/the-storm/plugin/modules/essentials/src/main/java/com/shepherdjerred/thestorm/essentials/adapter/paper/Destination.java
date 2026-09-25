package com.shepherdjerred.thestorm.essentials.adapter.paper;

import java.util.Optional;
import org.bukkit.Location;
import org.bukkit.entity.Player;

/** Where a teleport leads, resolved when the warmup ends so it follows a moving player. */
interface Destination {

  /** The target location now, or empty if it no longer exists (world unloaded, player left). */
  Optional<Location> resolve();

  /** How to name it in messages, for example {@code home "base"}. */
  String describe();

  /** A fixed location. */
  static Destination fixed(Location location, String description) {
    return new Destination() {
      @Override
      public Optional<Location> resolve() {
        return Optional.of(location.clone());
      }

      @Override
      public String describe() {
        return description;
      }
    };
  }

  /** Wherever {@code target} is when the warmup ends, if still online. */
  static Destination player(Player target) {
    return new Destination() {
      @Override
      public Optional<Location> resolve() {
        return target.isOnline() ? Optional.of(Positions.current(target)) : Optional.empty();
      }

      @Override
      public String describe() {
        return target.getName();
      }
    };
  }
}
