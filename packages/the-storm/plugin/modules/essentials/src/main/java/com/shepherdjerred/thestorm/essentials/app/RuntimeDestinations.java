package com.shepherdjerred.thestorm.essentials.app;

import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import java.util.Optional;

/** SQLite-backed spawn and random-travel origins; repository config supplies the spawn seed. */
public final class RuntimeDestinations {
  public record Origin(double x, double y, double z) {}

  private final StaffState state;
  private final Position seed;

  public RuntimeDestinations(StaffState state, Position seed) {
    this.state = state;
    this.seed = seed;
  }

  public Position spawn() {
    return state.find("spawn", "default", Position.class).orElse(seed);
  }

  public Optional<Origin> random(String world) {
    return state
        .find("rtp", world, Position.class)
        .map(position -> new Origin(position.x(), position.y(), position.z()));
  }
}
