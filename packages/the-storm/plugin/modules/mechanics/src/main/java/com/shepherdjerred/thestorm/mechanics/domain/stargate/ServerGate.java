package com.shepherdjerred.thestorm.mechanics.domain.stargate;

import com.shepherdjerred.thestorm.mechanics.domain.grid.Direction;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;

/** A repository-owned world-selection gate, fixed at an approved spawn location. */
public record ServerGate(
    String id,
    String world,
    Pos origin,
    Direction across,
    Pos sign,
    Boolean allowPreservedPortal,
    List<Destination> destinations) {

  public ServerGate {
    java.util.Objects.requireNonNull(allowPreservedPortal, "allowPreservedPortal");
    if (!id.matches("[a-z0-9_-]+") || world.isBlank()) {
      throw new IllegalArgumentException("server Stargate needs an id and a world");
    }
    destinations = List.copyOf(destinations);
    if (destinations.isEmpty())
      throw new IllegalArgumentException("server Stargate needs destinations");
    var labels = new HashSet<String>();
    for (var destination : destinations) {
      if (!labels.add(destination.label().toLowerCase(java.util.Locale.ROOT))) {
        throw new IllegalArgumentException(
            "duplicate server Stargate destination: " + destination.label());
      }
    }
    // Validate geometry as strictly as a stored player gate; IDs here are only validation values.
    new Stargate(
        new UUID(0, 0),
        new UUID(0, 0),
        "World Gate",
        new UUID(0, 0),
        new UUID(0, 0),
        sign,
        new StargateFrame(origin, across, StargateFrame.Shape.CIRCLE),
        null,
        false);
  }

  /** An explicit landing, also checked against the inventory-isolated creative entry. */
  public record Destination(String label, String world, Kind kind, Pos landing) {
    public Destination {
      label = Names.require(label);
      java.util.Objects.requireNonNull(kind, "destination kind");
      java.util.Objects.requireNonNull(landing, "destination landing");
      if (world.isBlank())
        throw new IllegalArgumentException("destination world must not be blank");
    }
  }

  public enum Kind {
    WORLD,
    CREATIVE
  }
}
