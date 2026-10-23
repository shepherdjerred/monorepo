package com.shepherdjerred.thestorm.creative.domain;

import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * One plot as protection, commands, and the map see it. The catalog is read first and a stored row
 * second. An empty owner that is not staff-held is an empty cell.
 */
public record PlotView(
    PlotId id,
    Optional<UUID> owner,
    String name,
    String description,
    Map<UUID, PlotRole> access,
    boolean staffHeld,
    boolean countsTowardCap) {

  public PlotView {
    access = Map.copyOf(access);
  }

  /** A claimed or staff-held plot. Empty cells are neither. */
  public boolean marked() {
    return owner.isPresent() || staffHeld;
  }
}
