package com.shepherdjerred.thestorm.towns.domain.parcel;

import java.util.Optional;
import java.util.UUID;

/** Reset and placement checkpoints. AVAILABLE follows a verified, saved plot reset. */
public record PlotRecovery(
    UUID id,
    String parcelId,
    UUID owner,
    Blob schematic,
    Blob materials,
    Blob auxiliary,
    State state,
    UUID token,
    Optional<Destination> destination) {

  public enum State {
    SNAPSHOT,
    AVAILABLE,
    PLACING,
    ROLLING_BACK,
    PLACED,
    MATERIALS
  }

  public record Destination(String world, int x, int y, int z, int width, int height, int depth) {
    public Destination {
      if (world.isBlank()
          || width <= 0
          || height <= 0
          || depth <= 0
          || Math.multiplyExact(Math.multiplyExact((long) width, height), depth) > 262_144) {
        throw new IllegalArgumentException("invalid packed shop destination bounds");
      }
      Math.addExact(x, width - 1);
      Math.addExact(y, height - 1);
      Math.addExact(z, depth - 1);
    }
  }

  public PlotRecovery withState(State next) {
    return new PlotRecovery(
        id, parcelId, owner, schematic, materials, auxiliary, next, token, destination);
  }
}
