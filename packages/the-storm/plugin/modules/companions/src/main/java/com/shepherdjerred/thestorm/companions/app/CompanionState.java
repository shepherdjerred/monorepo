package com.shepherdjerred.thestorm.companions.app;

import java.util.Base64;
import java.util.Optional;
import java.util.UUID;

/** Durable survival snapshot; the runtime body is a view of this state. */
public record CompanionState(
    UUID npcId, Position position, Vitals vitals, String inventory, Optional<Building> building) {
  public CompanionState {
    Base64.getDecoder().decode(inventory);
  }

  public record Position(String world, double x, double y, double z, float yaw, float pitch) {
    public Position {
      if (world.isBlank()
          || !Double.isFinite(x)
          || !Double.isFinite(y)
          || !Double.isFinite(z)
          || !Float.isFinite(yaw)
          || !Float.isFinite(pitch))
        throw new IllegalArgumentException("invalid companion position");
    }
  }

  public record Vitals(double health, int food, float saturation, int level, float experience) {
    public Vitals {
      if (!Double.isFinite(health)
          || health < 0
          || health > 20
          || food < 0
          || food > 20
          || !Float.isFinite(saturation)
          || saturation < 0
          || saturation > 20
          || level < 0
          || !Float.isFinite(experience)
          || experience < 0
          || experience > 1) throw new IllegalArgumentException("invalid companion vitals");
    }
  }

  public record Building(Position origin, int width, int depth, String material, int nextBlock) {
    public Building {
      if (width < 3
          || width > 12
          || depth < 3
          || depth > 12
          || nextBlock < 0
          || nextBlock > 256
          || material.isBlank()) throw new IllegalArgumentException("invalid building progress");
    }
  }
}
