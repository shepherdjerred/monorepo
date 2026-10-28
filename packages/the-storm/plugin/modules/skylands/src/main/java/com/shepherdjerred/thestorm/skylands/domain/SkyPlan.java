package com.shepherdjerred.thestorm.skylands.domain;

import java.util.List;

/** Immutable generation result. Chunk ownership does not depend on population order. */
public record SkyPlan(
    SkyCell cell,
    SkyCell.Kind kind,
    List<SkyPiece> pieces,
    List<Edit> edits,
    List<Resident> residents) {
  public enum Phase {
    FOUNDATION,
    DETAIL
  }

  public record Edit(SkyPosition position, String block, Phase phase) {
    public Edit(SkyPosition position, String block) {
      this(position, block, Phase.DETAIL);
    }
  }

  public enum ResidentKind {
    VILLAGER,
    LOOT_MINECART,
    IRON_GOLEM,
    CAT,
    COW,
    SHEEP,
    HORSE
  }

  public record Resident(SkyPosition position, ResidentKind kind) {}

  public SkyPlan {
    pieces = List.copyOf(pieces);
    edits = List.copyOf(edits);
    residents = List.copyOf(residents);
    var bounds = cell.interior();
    if (edits.stream().anyMatch(e -> !bounds.contains(e.position()))
        || pieces.stream()
            .anyMatch(p -> !bounds.contains(p.bounds().min()) || !bounds.contains(p.bounds().max()))
        || residents.stream().anyMatch(r -> !bounds.contains(r.position()))) {
      throw new IllegalArgumentException("Feature escaped its cell " + cell);
    }
  }

  public static SkyPlan empty(SkyCell cell, SkyCell.Kind kind) {
    return new SkyPlan(cell, kind, List.of(), List.of(), List.of());
  }

  public boolean intersects(SkyBounds bounds) {
    return pieces.stream().anyMatch(p -> p.bounds().intersects(bounds))
        || edits.stream().anyMatch(e -> bounds.contains(e.position()));
  }
}
